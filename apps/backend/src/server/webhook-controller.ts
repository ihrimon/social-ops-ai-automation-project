import express, { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { facebookConfig, instagramConfig, rateLimitConfig } from "../config/env.js";
import { logger } from "../infra/logger.js";
import { errorMessage } from "../infra/errors.js";
import { addConversationMessage } from "../modules/messenger/conversation.store.js";
import { pauseUserReplies, queueUserMessage } from "../modules/messenger/queue.worker.js";
import { isBotSentMessage, rememberIncomingMessage } from "../modules/messenger/dedupe.store.js";
import { moderateComment, moderateInstagramComment } from "../modules/comments/comment.service.js";
import {
  isValidWebhookVerification,
  verifyFacebookSignature,
} from "../integrations/facebook/webhook-verifier.js";
import { isWhatsAppConfigured } from "../integrations/whatsapp/send.js";
import { isInstagramConfigured } from "../integrations/instagram/send.js";
import { webhookPayloadSchema, type WebhookPayload } from "./webhook.schema.js";

const MAX_BODY_BYTES = "1mb";

/**
 * Handles one Messenger/Instagram `messaging` event. Instagram DMs use the exact
 * same event shape as Messenger (same underlying Meta platform), so this takes a
 * `platform` param rather than being duplicated — only the "who am I" comparison
 * (for echo/handoff detection) and the queued platform differ.
 */
async function processMessagingEvent(
  event: any,
  platform: "messenger" | "instagram" = "messenger"
): Promise<void> {
  const senderId = event.sender?.id;
  const recipientId = event.recipient?.id;
  const message = event.message;

  if (!senderId || !message) {
    return;
  }

  const selfId = platform === "instagram" ? instagramConfig.igUserId : facebookConfig.pageId;

  // Intercept human admin replies (echo events)
  if (message.is_echo || senderId === selfId) {
    const actualUserId = recipientId;
    const messageText = message.text?.trim();
    const messageId = message.mid;

    if (messageId && (await isBotSentMessage(messageId))) {
      // This echo is from our own bot/app. Ignore it since it's already saved during reply generation.
      return;
    }

    if (actualUserId && messageText) {
      logger.info(
        `Human admin reply detected. Saving to conversation memory for user ${actualUserId}: ${messageText}`
      );
      await addConversationMessage(actualUserId, "assistant", messageText, { isHumanAdmin: true });
      await pauseUserReplies(actualUserId);
    }
    return;
  }

  const messageId = message.mid || `${senderId}:${event.timestamp || Date.now()}`;

  if (!(await rememberIncomingMessage(messageId, senderId))) {
    logger.info(`Duplicate ${platform} event ignored: ${messageId}`);
    return;
  }

  const messageText = message.text?.trim();

  if (!messageText) {
    logger.info(`Non-text ${platform} event ignored: ${messageId}`);
    return;
  }

  await queueUserMessage(senderId, messageText, messageId, platform);
  logger.info(`Queued ${platform} message from ${senderId} for consolidated reply.`);
}

async function processCommentChange(change: any): Promise<void> {
  const value = change.value || {};
  const commentId = value.comment_id;
  const postId = value.post_id;
  const commenterId = value.from?.id;
  const commentText = value.message?.trim();

  logger.info("Facebook feed change received:", {
    field: change.field,
    item: value.item,
    verb: value.verb,
    commentId,
    postId,
    parentId: value.parent_id,
    commenterId,
    hasCommentText: Boolean(commentText),
  });

  if (change.field !== "feed") {
    logger.info("Facebook feed change ignored: field is not 'feed'.");
    return;
  }

  if (value.item !== "comment" || value.verb !== "add") {
    logger.info("Facebook feed change ignored: it is not a newly added comment.");
    return;
  }

  // Only answer top-level comments on this Page's own posts. Replies in a
  // visitor thread are intentionally ignored to prevent public reply loops.
  let ignoreReason = null;
  if (!commentId) ignoreReason = "comment_id is missing";
  else if (!postId) ignoreReason = "post_id is missing";
  else if (!commenterId) ignoreReason = "comment author ID is missing";
  else if (!commentText) ignoreReason = "comment text is missing";
  else if (String(commenterId) === String(facebookConfig.pageId))
    ignoreReason = "comment was written by this Page";
  else if (!String(postId).startsWith(`${facebookConfig.pageId}_`))
    ignoreReason = "comment is not on this Page's post";
  else if (value.parent_id && String(value.parent_id) !== String(postId))
    ignoreReason = "comment is a reply inside another comment thread";

  if (ignoreReason) {
    logger.info(`Facebook comment ignored (${commentId || "unknown"}): ${ignoreReason}.`);
    return;
  }

  await moderateComment({ commentId, postId, commenterId, commentText });
}

let warnedInstagramNotConfigured = false;

/**
 * Handles Instagram comment-webhook `changes` entries (`instagram` object).
 * Distinct field names from Facebook's feed-change shape (`id`/`text`/`media.id`
 * instead of `comment_id`/`message`/`post_id`), which is why this is a separate
 * parser rather than sharing `processCommentChange`.
 */
async function processInstagramCommentChange(change: any): Promise<void> {
  if (change.field !== "comments") {
    return;
  }

  if (!isInstagramConfigured()) {
    if (!warnedInstagramNotConfigured) {
      logger.warn("Instagram comment received but IG_USER_ID is not configured. Ignoring.");
      warnedInstagramNotConfigured = true;
    }
    return;
  }

  const value = change.value || {};
  const commentId = value.id;
  const mediaId = value.media?.id;
  const commenterId = value.from?.id;
  const commentText = value.text?.trim();

  logger.info("Instagram comment change received:", {
    commentId,
    mediaId,
    commenterId,
    hasCommentText: Boolean(commentText),
  });

  let ignoreReason = null;
  if (!commentId) ignoreReason = "comment id is missing";
  else if (!mediaId) ignoreReason = "media id is missing";
  else if (!commenterId) ignoreReason = "comment author ID is missing";
  else if (!commentText) ignoreReason = "comment text is missing";
  else if (String(commenterId) === String(instagramConfig.igUserId))
    ignoreReason = "comment was written by this account";

  if (ignoreReason) {
    logger.info(`Instagram comment ignored (${commentId || "unknown"}): ${ignoreReason}.`);
    return;
  }

  await moderateInstagramComment({ commentId, mediaId, commenterId, commentText });
}

let warnedWhatsAppNotConfigured = false;

/**
 * Handles WhatsApp Cloud API webhook `changes` entries (`whatsapp_business_account`
 * object). Same signature verification and Zod envelope as Messenger — only the
 * shape inside `change.value` differs (WhatsApp's documented `messages` field:
 * `{ from, id, type, text: { body } }` per inbound message).
 *
 * No human-admin handoff detection here (unlike `processMessagingEvent`'s `is_echo`
 * handling) — WhatsApp Cloud API has no equivalent signal for a manual takeover, so
 * that's intentionally out of scope for now, not an oversight.
 */
async function processWhatsAppChange(change: any): Promise<void> {
  if (change.field !== "messages") {
    return;
  }

  if (!isWhatsAppConfigured()) {
    if (!warnedWhatsAppNotConfigured) {
      logger.warn(
        "WhatsApp message received but WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID is not configured. Ignoring."
      );
      warnedWhatsAppNotConfigured = true;
    }
    return;
  }

  const messages = change.value?.messages || [];
  for (const message of messages) {
    const senderId = message.from;
    const messageId = message.id;

    if (!senderId || !messageId) {
      continue;
    }

    if (!(await rememberIncomingMessage(messageId, senderId))) {
      logger.info(`Duplicate WhatsApp event ignored: ${messageId}`);
      continue;
    }

    const messageText = message.text?.body?.trim();
    if (!messageText) {
      logger.info(`Non-text WhatsApp event ignored: ${messageId}`);
      continue;
    }

    await queueUserMessage(senderId, messageText, messageId, "whatsapp");
    logger.info(`Queued WhatsApp message from ${senderId} for consolidated reply.`);
  }
}

async function handleWebhookPost(req: Request, res: Response): Promise<void> {
  try {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));

    if (!verifyFacebookSignature(req, rawBody)) {
      logger.warn("Unauthorized webhook request rejected (invalid signature).");
      res.status(403).send("Forbidden");
      return;
    }

    const parseResult = webhookPayloadSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn("Webhook payload failed validation:", {
        issues: parseResult.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`
        ),
      });
      res.status(400).send("Bad Request");
      return;
    }

    const payload: WebhookPayload = parseResult.data;
    logger.info("Webhook POST received payload:", { payload });

    res.status(200).send("EVENT_RECEIVED");

    if (payload.object === "whatsapp_business_account") {
      const whatsappChanges = payload.entry.flatMap((entry) => entry.changes || []);
      for (const change of whatsappChanges) {
        await processWhatsAppChange(change);
      }
      return;
    }

    if (payload.object === "instagram") {
      const instagramEvents = payload.entry.flatMap((entry) => entry.messaging || []);
      for (const event of instagramEvents) {
        await processMessagingEvent(event, "instagram");
      }

      const instagramCommentChanges = payload.entry.flatMap((entry) => entry.changes || []);
      for (const change of instagramCommentChanges) {
        await processInstagramCommentChange(change);
      }
      return;
    }

    if (payload.object !== "page") {
      logger.info("Ignoring unrecognized webhook object:", { object: payload.object });
      return;
    }

    const events = payload.entry.flatMap((entry) => entry.messaging || []);
    // Preserve Messenger's event order. This matters when an admin handoff and
    // a user message arrive in the same webhook payload.
    for (const event of events) {
      await processMessagingEvent(event);
    }

    const commentChanges = payload.entry.flatMap((entry) => entry.changes || []);
    if (commentChanges.length) {
      logger.info(`Processing ${commentChanges.length} Facebook Page feed change(s).`);
    }
    for (const change of commentChanges) {
      await processCommentChange(change);
    }
  } catch (error) {
    logger.error("Webhook POST handling failed:", { error: errorMessage(error) });

    if (!res.headersSent) {
      res.status(400).send("Bad Request");
    }
  }
}

function handleWebhookVerification(req: Request, res: Response): void {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;

  if (isValidWebhookVerification(mode, token)) {
    logger.info("Facebook webhook verified successfully.");
    res.status(200).send(typeof challenge === "string" ? challenge : "");
    return;
  }

  logger.warn("Facebook webhook verification failed.");
  res.status(403).send("Forbidden");
}

/**
 * Facebook signs the exact raw bytes it sends, so this route keeps its own
 * `express.json()` (with `verify`) instead of relying on a global body
 * parser — the raw buffer must survive parsing for `verifyFacebookSignature`.
 */
export const webhookRouter: Router = Router();

// Protects the public webhook endpoint from abuse/DoS — keyed by client IP
// (correct only if serverConfig.trustProxyHops is set when behind a proxy).
webhookRouter.use(
  rateLimit({
    windowMs: rateLimitConfig.windowMs,
    limit: rateLimitConfig.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

webhookRouter.use(
  express.json({
    limit: MAX_BODY_BYTES,
    type: "*/*",
    verify: (req, _res, buf) => {
      (req as Request).rawBody = buf;
    },
  })
);

webhookRouter.get("/", handleWebhookVerification);
webhookRouter.post("/", handleWebhookPost);
