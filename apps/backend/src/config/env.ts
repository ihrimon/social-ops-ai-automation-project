import dotenv from "dotenv";
dotenv.config();

import { assertRequiredEnv } from "../infra/validation.js";

// Fail fast at boot instead of surfacing confusing errors deep inside a
// generation/posting flow later.
assertRequiredEnv(process.env);

/** Gemini / AI (required) + optional AI add-ons */
export const aiConfig = {
  geminiApiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.6-flash",
  embeddingModel: process.env.GEMINI_EMBEDDING_MODEL,
  huggingfaceApiKey: process.env.HUGGINGFACE_API_KEY,
  aiHordeApiKey: process.env.AI_HORDE_API_KEY,
  hordeApiBase: process.env.HORDE_API_BASE,
};

/** Cloudinary — permanent hosting for AI-generated images. */
export const cloudinaryConfig = {
  cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  apiKey: process.env.CLOUDINARY_API_KEY,
  apiSecret: process.env.CLOUDINARY_API_SECRET_KEY,
};

/** Facebook Graph API / Messenger / webhook */
export const facebookConfig = {
  pageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN,
  pageId: process.env.FB_PAGE_ID,
  verifyToken: process.env.FB_VERIFY_TOKEN,
  appSecret: process.env.FB_APP_SECRET,
  graphApiVersion: process.env.FB_GRAPH_API_VERSION || "v23.0",
  appId: process.env.FB_APP_ID,
};

/** HTTP server. */
export const serverConfig = {
  port: process.env.PORT || 3000,
  /**
   * Number of reverse-proxy hops to trust for X-Forwarded-For (Express's
   * `trust proxy` setting) — needed for rate limiting to key off the real
   * client IP instead of the proxy's. 0 (default) assumes the app is
   * directly exposed; set to 1 if it sits behind a single proxy (nginx,
   * Cloudflare Tunnel, ngrok, a PaaS load balancer, etc.).
   */
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS || 0),
};

/** App runtime mode / logging verbosity. */
export const appConfig = {
  nodeEnv: process.env.NODE_ENV || "development",
  logLevel: process.env.LOG_LEVEL || "info",
};

/** Error tracking (Sentry). */
export const monitoringConfig = {
  sentryDsn: process.env.SENTRY_DSN,
};

/** Webhook endpoint rate limiting (express-rate-limit). */
export const rateLimitConfig = {
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  maxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 100),
};

/** Webhook request body size limit. */
export const webhookConfig = {
  maxBodyBytes: process.env.WEBHOOK_MAX_BODY_BYTES || "1mb",
};

/** Admin dashboard auth. */
export const adminConfig = {
  dashboardJwtSecret: process.env.ADMIN_DASHBOARD_JWT_SECRET,
  dashboardPassword: process.env.ADMIN_DASHBOARD_PASSWORD,
  /** Gate the daily post behind admin approval instead of auto-publishing. Off by default — preserves existing behavior. */
  requirePostApproval: process.env.REQUIRE_POST_APPROVAL === "true",
};

/** CORS allowlist for the admin dashboard frontend. */
export const corsConfig = {
  origin: process.env.CORS_ORIGIN,
};

/** MongoDB connection, collection names, and vector search index names. */
export const mongoConfig = {
  uri: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DB_NAME || "social-ops-ai-automation",
  backupDir: process.env.MONGODB_BACKUP_DIR || "backups",
  conversationsCollection: process.env.MONGODB_CONVERSATIONS_COLLECTION || "conversation_messages",
  conversationVectorIndex:
    process.env.MONGODB_CONVERSATION_VECTOR_INDEX ||
    process.env.MONGODB_VECTOR_INDEX ||
    "conversation_embedding_index",
  knowledgeCollection: process.env.MONGODB_KNOWLEDGE_COLLECTION || "knowledge_chunks",
  knowledgeVectorIndex: process.env.MONGODB_KNOWLEDGE_VECTOR_INDEX || "knowledge_embedding_index",
  embeddingCacheCollection: process.env.MONGODB_EMBEDDING_CACHE_COLLECTION || "embedding_cache",
  postLogsCollection: process.env.MONGODB_POST_LOGS_COLLECTION || "post_logs",
  messageDedupeCollection: process.env.MONGODB_MESSAGE_DEDUPE_COLLECTION || "processed_messages",
  commentDedupeCollection: process.env.MONGODB_COMMENT_DEDUPE_COLLECTION || "processed_comments",
  pendingRepliesCollection: process.env.MONGODB_PENDING_REPLIES_COLLECTION || "pending_replies",
  topicsCollection: process.env.MONGODB_TOPICS_COLLECTION || "topics",
  leadsCollection: process.env.MONGODB_LEADS_COLLECTION || "leads",
  maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 20),
  minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE || 0),
  serverSelectionTimeoutMs: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 5000),
};

/**
 * Comment-moderation polling fallback — Graph API `feed` webhooks are
 * unreliable for some Pages (a known "New Pages Experience" quirk), so this
 * worker periodically fetches recent posts/comments directly as a
 * guaranteed-to-work backup. Safe to run alongside the webhook path since
 * both share the same comment dedupe store.
 */
export const commentsConfig = {
  pollMs: Number(process.env.COMMENT_POLL_MS || 60 * 1000),
  postsToCheck: Number(process.env.COMMENT_POLL_POSTS_LIMIT || 5),
  commentsPerPost: Number(process.env.COMMENT_POLL_COMMENTS_LIMIT || 25),
};

/**
 * WhatsApp Cloud API (optional) — reuses the same Meta App as `facebookConfig`
 * (same `FB_APP_SECRET`/`FB_VERIFY_TOKEN`, one webhook subscribed to both the
 * "page" and "whatsapp_business_account" objects), so only the send-side
 * credentials are needed here.
 */
export const whatsappConfig = {
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
};

/**
 * Google Sheets lead sync (optional) — a free-tier "CRM" export for leads. Uses a
 * service account (not OAuth): create one in Google Cloud, share the target Sheet
 * with its email as an Editor, and set these. Unset, the sync silently no-ops.
 */
export const googleSheetsConfig = {
  spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
  serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  // A PEM private key pasted into a single-line .env value keeps its newlines escaped as `\n`.
  privateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  sheetName: process.env.GOOGLE_SHEETS_SHEET_NAME || "Leads",
};

/** Messenger consolidated-reply debounce queue/worker tuning. */
export const messengerConfig = {
  replyDebounceMs: Number(process.env.MESSENGER_REPLY_DEBOUNCE_MS || 20 * 1000),
  adminPauseMs: Number(process.env.MESSENGER_ADMIN_PAUSE_MS || 10 * 60 * 1000),
  replyPollMs: Number(process.env.MESSENGER_REPLY_POLL_MS || 10 * 1000),
  replyConcurrency: Number(process.env.MESSENGER_REPLY_CONCURRENCY || 3),
  replyLeaseMs: Number(process.env.MESSENGER_REPLY_LEASE_MS || 5 * 60 * 1000),
  replyRetryMs: Number(process.env.MESSENGER_REPLY_RETRY_MS || 60 * 1000),
  pendingMessageLimit: Number(process.env.MESSENGER_PENDING_MESSAGE_LIMIT || 20),
};

/** Convenience bundle — prefer importing the topic-specific config */
export const config = {
  ai: aiConfig,
  cloudinary: cloudinaryConfig,
  facebook: facebookConfig,
  server: serverConfig,
  mongo: mongoConfig,
  comments: commentsConfig,
  messenger: messengerConfig,
  app: appConfig,
  monitoring: monitoringConfig,
  rateLimit: rateLimitConfig,
  webhook: webhookConfig,
  admin: adminConfig,
  cors: corsConfig,
  googleSheets: googleSheetsConfig,
  whatsapp: whatsappConfig,
};
