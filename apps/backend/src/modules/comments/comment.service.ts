import { aiConfig, facebookConfig, instagramConfig } from "../../config/env.js";
import { logger } from "../../infra/logger.js";
import { generateContent } from "../../ai/client.js";
import { errorMessage } from "../../infra/errors.js";
import { buildCommentClassifyPrompt } from "../../ai/prompts/classify.prompt.js";
import { getRelevantKnowledge } from "../knowledge/knowledge.store.js";
import { graphGet, graphPost } from "../../integrations/facebook/graph-client.js";
import { forgetIncomingComment, rememberIncomingComment } from "./dedupe.store.js";

const POST_CONTEXT_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHED_POSTS = 100;
const postContextCache = new Map<string, { text: string; expiresAt: number }>();

function cachePostContext(postId: string, text: string): void {
  postContextCache.set(postId, { text, expiresAt: Date.now() + POST_CONTEXT_CACHE_TTL_MS });
  if (postContextCache.size > MAX_CACHED_POSTS) {
    postContextCache.delete(postContextCache.keys().next().value as string);
  }
}

export async function getFacebookPostContext(postId: string): Promise<string> {
  const cached = postContextCache.get(postId);
  if (cached && cached.expiresAt > Date.now()) {
    logger.info(`Using cached Facebook post context for ${postId}.`);
    return cached.text;
  }

  logger.info(`Requesting Facebook post context: ${postId}`);
  const response = await graphGet(postId, { fields: "message,story,permalink_url" });

  const postText = [response.data.message, response.data.story].filter(Boolean).join("\n").trim();

  cachePostContext(postId, postText || "No post text is available.");
  return postText || "No post text is available.";
}

export async function replyToFacebookComment(commentId: string, text: string) {
  logger.info(`Posting public Facebook reply to comment ${commentId}.`);
  const response = await graphPost(`${commentId}/comments`, { message: text });

  logger.info(`Facebook comment reply API succeeded for ${commentId}.`);
  return response.data;
}

/** Shared by Facebook and Instagram — the classify/reply prompt itself is platform-neutral. */
export async function generateCommentReply(
  postText: string,
  commentText: string
): Promise<string | null> {
  try {
    logger.info("Generating AI decision for comment reply.");
    const relevantKnowledge = await getRelevantKnowledge(`${postText}\n${commentText}`);
    const prompt = buildCommentClassifyPrompt(postText, commentText, relevantKnowledge);
    const reply = await generateContent(aiConfig.model, prompt);

    if (!reply || reply.toUpperCase() === "SKIP") {
      logger.info("AI classified comment as non-service-related.");
      return null;
    }

    logger.info("AI classified comment as service-related.");
    return reply.slice(0, 1000);
  } catch (error) {
    logger.error("Comment reply generation failed:", { error: errorMessage(error) });
    return null;
  }
}

/** Instagram equivalent of `getFacebookPostContext` — a media object's caption. */
export async function getInstagramMediaContext(mediaId: string): Promise<string> {
  const cached = postContextCache.get(mediaId);
  if (cached && cached.expiresAt > Date.now()) {
    logger.info(`Using cached Instagram media context for ${mediaId}.`);
    return cached.text;
  }

  logger.info(`Requesting Instagram media context: ${mediaId}`);
  const response = await graphGet(mediaId, { fields: "caption,permalink" });

  const mediaText = (response.data.caption || "").trim();

  cachePostContext(mediaId, mediaText || "No post text is available.");
  return mediaText || "No post text is available.";
}

export async function replyToInstagramComment(commentId: string, text: string) {
  logger.info(`Posting public Instagram reply to comment ${commentId}.`);
  const response = await graphPost(`${commentId}/replies`, { message: text });

  logger.info(`Instagram comment reply API succeeded for ${commentId}.`);
  return response.data;
}

export interface IncomingComment {
  commentId: string;
  postId: string;
  commenterId: string;
  commentText: string;
}

/**
 * Shared moderation pipeline for one top-level comment: dedupe → fetch post
 * context → AI classify/generate → reply. Used by both the webhook path
 * (server/webhook-controller.ts) and the polling fallback
 * (jobs/comment-poll-worker.ts) — whichever sees a given comment first
 * "wins" via the shared dedupe store, so running both concurrently is safe
 * and never produces a duplicate public reply.
 */
export async function moderateComment({
  commentId,
  postId,
  commenterId,
  commentText,
}: IncomingComment): Promise<void> {
  if (!commentId || !postId || !commenterId || !commentText) {
    return;
  }

  if (String(commenterId) === String(facebookConfig.pageId)) {
    return; // the Page commenting on its own post
  }

  if (!(await rememberIncomingComment(commentId, postId, commenterId))) {
    logger.info(`Duplicate Facebook comment ignored: ${commentId}`);
    return;
  }

  try {
    logger.info(`Fetching post context for Facebook comment ${commentId}.`);
    const postText = await getFacebookPostContext(postId);
    logger.info(
      `Post context loaded for ${commentId} (${postText.length} characters). Generating AI decision.`
    );
    const reply = await generateCommentReply(postText, commentText);
    if (!reply) {
      logger.info(
        `Facebook comment ${commentId} was classified as non-service-related; no reply sent.`
      );
      return;
    }

    logger.info(`Service-related Facebook comment detected (${commentId}). Sending public reply.`);
    await replyToFacebookComment(commentId, reply);
    logger.info(`Sent Facebook comment reply for ${commentId}.`);
  } catch (error) {
    // The Graph API's own error detail is already embedded in error.message
    // by integrations/facebook/graph-client.ts, so nothing else to unwrap here.
    logger.error(`Facebook comment reply failed for ${commentId}:`, { error: errorMessage(error) });
    await forgetIncomingComment(commentId);
  }
}

export interface IncomingInstagramComment {
  commentId: string;
  mediaId: string;
  commenterId: string;
  commentText: string;
}

/**
 * Instagram equivalent of `moderateComment`: dedupe → fetch media caption for
 * context → AI classify/generate → reply. Webhook-only for now — no polling
 * fallback exists for Instagram (the Facebook one exists specifically because
 * Page `feed` webhooks were found unreliable for some Pages; no equivalent issue
 * observed on Instagram yet).
 */
export async function moderateInstagramComment({
  commentId,
  mediaId,
  commenterId,
  commentText,
}: IncomingInstagramComment): Promise<void> {
  if (!commentId || !mediaId || !commenterId || !commentText) {
    return;
  }

  if (String(commenterId) === String(instagramConfig.igUserId)) {
    return; // the account commenting on its own media
  }

  if (!(await rememberIncomingComment(commentId, mediaId, commenterId))) {
    logger.info(`Duplicate Instagram comment ignored: ${commentId}`);
    return;
  }

  try {
    logger.info(`Fetching media context for Instagram comment ${commentId}.`);
    const postText = await getInstagramMediaContext(mediaId);
    logger.info(
      `Media context loaded for ${commentId} (${postText.length} characters). Generating AI decision.`
    );
    const reply = await generateCommentReply(postText, commentText);
    if (!reply) {
      logger.info(
        `Instagram comment ${commentId} was classified as non-service-related; no reply sent.`
      );
      return;
    }

    logger.info(`Service-related Instagram comment detected (${commentId}). Sending public reply.`);
    await replyToInstagramComment(commentId, reply);
    logger.info(`Sent Instagram comment reply for ${commentId}.`);
  } catch (error) {
    logger.error(`Instagram comment reply failed for ${commentId}:`, {
      error: errorMessage(error),
    });
    await forgetIncomingComment(commentId);
  }
}
