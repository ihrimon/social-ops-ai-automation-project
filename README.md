# 🤖 Social Ops AI Automation

AI-driven Facebook Page automation: scheduled article posts, Messenger reply generation with conversation memory, comment moderation, and a Mongo-backed RAG knowledge base powered by **Google Gemini**.

---

## 📋 Table of Contents

- [🌟 Features](#-features)
- [🏗️ Architecture](#️-architecture)
- [📂 Project Structure](#-project-structure)
- [📋 Prerequisites](#-prerequisites)
- [⚙️ Environment Variables](#️-environment-variables)
- [🔑 Facebook App & Webhook Setup](#-facebook-app--webhook-setup)
- [🧠 Customizing the Knowledge Base](#-customizing-the-knowledge-base)
- [🛠️ Admin Dashboard](#️-admin-dashboard)
- [📊 Google Sheets Lead Sync](#-google-sheets-lead-sync)
- [🚀 Running the Project](#-running-the-project)
- [🧪 Testing & Quality](#-testing--quality)
- [🛡️ Reliability & Security Notes](#️-reliability--security-notes)

---

## 🌟 Features

### 📅 1. Daily Automated Post

- Picks the oldest unused topic from MongoDB (`modules/content/topic.service.ts`); when the queue is empty, generates 30 new Bangla service-focused topics via Gemini.
- Writes the article, generates a best-effort image (AI Horde → Cloudinary hosting), and publishes a text-only or photo post to the Facebook Page.
- Runs daily via `node-cron` (`jobs/daily-post-job.ts`, Asia/Dhaka timezone).
- **Idempotent**: a `post_logs` date-key guard prevents double-posting on retries/restarts.
- **Crash-safe topic claim**: if article generation or posting fails after a topic is claimed, the topic is reverted to unused so it isn't lost from the queue.
- **Optional approval gate**: set `REQUIRE_POST_APPROVAL=true` to hold the generated draft for admin approval (via the [Admin Dashboard](#️-admin-dashboard)) instead of auto-publishing. Off by default — the fully-automatic flow above is unchanged.

### 💬 2. Messenger Auto-Responder

- Incoming messages are buffered per user and debounced (`modules/messenger/queue.worker.ts`) so rapid-fire messages get one consolidated AI reply instead of several.
- Reply generation (`modules/messenger/reply.service.ts`) pulls relevant context via the RAG knowledge store and recent conversation history.
- **Human admin handoff**: detects `is_echo` events from a human agent replying manually and pauses AI replies for that user for a configurable window.
- Claim/lease based worker with crash recovery (expired leases are reclaimed; already-delivered replies are never resent).

### 💬 3. Public Comment Auto-Reply

- Fetches the parent post's text for context (`modules/comments/comment.service.ts`), then asks Gemini to classify the comment as a genuine business inquiry or not (spam/emoji/praise/etc. are skipped).
- Only replies to top-level comments on the Page's own posts — replies inside a comment thread are ignored to avoid public loops.
- Runs on two independent paths that share the same dedupe store, so no duplicate replies:
  - **Webhook path** (`server/webhook-controller.ts`) — real-time `feed` events.
  - **Polling fallback** (`jobs/comment-poll-worker.ts`) — periodically re-checks recent posts/comments, since Graph API feed webhooks are unreliable for some Pages.

### 🧠 4. RAG Knowledge Base

- `knowledge-base.json` is chunked and synced into MongoDB on startup (`modules/knowledge/knowledge.store.ts`), with each chunk embedded via Gemini and cached (`embedding_cache` collection, content-hash based to skip unchanged re-embeds).
- Retrieval uses **hybrid search** — MongoDB `$vectorSearch` + `$text` — merged with Reciprocal Rank Fusion (RRF), with graceful fallback to a local in-memory/JSON cache if Mongo or vector search is unavailable.

### 🧾 5. Lead Requirement Extraction & Sheets Sync

- Every Messenger reply cycle, Gemini's JSON mode (`ai/client.ts`'s `generateStructuredContent`) reads project-requirement facts (name, phone, business type, features, deadline, budget hint, etc.) back out of the conversation (`modules/messenger/lead-extraction.service.ts`) and merges them into the lead record — never overwriting previously-known fields with a blank.
- Optionally synced to a Google Sheet (`modules/messenger/lead-sheet-sync.service.ts`) as a free, familiar "CRM" view — see [Google Sheets Lead Sync](#-google-sheets-lead-sync) below. Entirely optional; unconfigured, sync silently no-ops.

### 🛠️ 6. Admin Dashboard

- A separate React SPA (`admin-dashboard/`) for post approval, browsing Messenger conversations (with manual AI pause/resume, and AI-extracted requirements shown read-only), and editing the knowledge base — see [Admin Dashboard](#️-admin-dashboard) below.
- Backed by a JWT-gated `/admin/*` API (`server/admin-controller.ts`) — a single shared admin password, rate-limited login, CORS scoped to just this router.

### 🛡️ 7. Resilience & Security

- HMAC (`x-hub-signature-256`) verification on every webhook request (`integrations/facebook/webhook-verifier.ts`).
- Zod-validated webhook payloads (`server/webhook.schema.ts`).
- Exponential-backoff retry (`infra/retry.ts`) around Gemini and Facebook Graph API calls.
- Centralized `AppError` hierarchy + Express 5 async error handling (`infra/errors.ts`, `server/http-server.ts`).
- `/health` (liveness) and `/ready` (readiness — Mongo + Gemini key checks) endpoints.
- Graceful shutdown on `SIGTERM`/`SIGINT` (drains the HTTP server, closes the Mongo connection).
- Fail-fast env validation at boot (`infra/validation.ts`) instead of surfacing confusing errors deep in a request flow.

---

## 🏗️ Architecture

```mermaid
flowchart TD
    FB["Facebook Graph API & Webhooks"]
    HMAC["HMAC signature verification"]
    SRV["Express HTTP server (apps/backend/src/index.ts)"]
    CRON["Daily cron job (Asia/Dhaka)"]
    POST["Post generator (daily-post-job.ts)"]
    MSG["Messenger queue (queue.worker.ts)"]
    CMT["Comment moderation (comment.service.ts)"]
    GEMINI["Google Gemini AI (apps/backend/src/ai/client.ts + prompts)"]
    MONGO[("MongoDB: RAG knowledge base, conversation memory,\npending replies, dedupe stores, post logs")]

    FB -- webhook events --> HMAC
    HMAC --> SRV
    CRON --> POST
    SRV --> MSG
    SRV --> CMT
    POST --> GEMINI
    MSG --> GEMINI
    CMT --> GEMINI
    GEMINI --> MONGO
    POST -.-> FB
    MSG -.-> FB
    CMT -.-> FB
```

Background workers (`apps/backend/src/jobs/`) run alongside the HTTP server in the same process:

- `daily-post-job.ts` — cron-scheduled post generation.
- `pending-reply-worker.ts` — polls and delivers debounced Messenger replies.
- `comment-poll-worker.ts` — polling fallback for comment moderation.

---

## 📂 Project Structure

This is an **npm workspaces monorepo** — `npm install` at the repo root installs both apps' dependencies into one lockfile. Every `src/`/`tests/`/config path mentioned elsewhere in this document is relative to `apps/backend/` unless stated otherwise.

```
apps/
├── backend/                       # Express/TypeScript backend — its own package.json
│   ├── src/
│   │   ├── ai/
│   │   │   ├── client.ts               # Shared Gemini client (generateContent, embeddings)
│   │   │   └── prompts/                # Prompt builders (article, topics, reply, classify)
│   │   ├── config/
│   │   │   └── env.ts                  # Centralized, typed env config (fail-fast validation)
│   │   ├── infra/
│   │   │   ├── errors.ts               # AppError hierarchy + errorMessage()
│   │   │   ├── logger.ts               # Structured logger
│   │   │   ├── retry.ts                # Exponential backoff helper
│   │   │   └── validation.ts           # Required-env assertion at boot
│   │   ├── integrations/
│   │   │   ├── facebook/               # graph-client, poster, messenger send API, webhook verifier
│   │   │   └── mongo/                  # connection client + db-init (indexes, TTLs, KB sync)
│   │   ├── modules/
│   │   │   ├── content/                # article/image generation, topic queue, post logs
│   │   │   ├── comments/                # comment moderation service + dedupe store
│   │   │   ├── messenger/               # reply service, debounce/claim queue worker, conversation memory
│   │   │   ├── knowledge/               # RAG knowledge store, embeddings, embedding cache
│   │   │   └── admin/                   # admin auth (JWT sign/verify, password check)
│   │   ├── jobs/                        # daily-post-job, pending-reply-worker, comment-poll-worker
│   │   ├── server/                      # Express app, webhook/health/admin controllers, schemas
│   │   └── index.ts                     # Entry point: bootstraps DB, jobs, workers, HTTP server
│   ├── tests/
│   │   ├── unit/                  # prompts, dedupe store, webhook verifier, admin auth
│   │   └── integration/           # webhook schema validation
│   ├── knowledge-base.json         # Business knowledge base (source for the RAG store)
│   └── Dockerfile
└── admin-dashboard/                # Separate Vite + React + TS admin SPA — its own package.json

package.json                        # Workspace root: "workspaces": ["apps/*"], shared husky/lint-staged/prettier
docker-compose.yml                  # Builds apps/backend/Dockerfile with the repo root as build context
```

---

## 📋 Prerequisites

- **Node.js** 18+
- **MongoDB** (Atlas recommended for Vector Search) or local MongoDB 6.0+
- **Google Gemini API key** ([Google AI Studio](https://aistudio.google.com/))
- **Facebook Page** with admin access

---

## ⚙️ Environment Variables

All config is centralized and typed in [apps/backend/src/config/env.ts](apps/backend/src/config/env.ts). Required variables are validated at boot ([apps/backend/src/infra/validation.ts](apps/backend/src/infra/validation.ts)) — the process fails fast with a clear error instead of breaking later mid-request.

```env
# Gemini / AI
GEMINI_API_KEY=your_gemini_api_key
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
HUGGINGFACE_API_KEY=
AI_HORDE_API_KEY=
HORDE_API_BASE=

# Cloudinary (permanent hosting for AI-generated images)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET_KEY=

# Facebook
FB_PAGE_ACCESS_TOKEN=your_facebook_page_access_token
FB_PAGE_ID=your_facebook_page_id
FB_VERIFY_TOKEN=your_webhook_verify_token
FB_APP_SECRET=your_facebook_app_secret
FB_APP_ID=
FB_GRAPH_API_VERSION=v23.0

# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# MongoDB
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?appName=Cluster0
MONGODB_DB_NAME=social-ops-ai-automation
MONGODB_CONVERSATIONS_COLLECTION=conversation_messages
MONGODB_CONVERSATION_VECTOR_INDEX=conversation_embedding_index
MONGODB_KNOWLEDGE_COLLECTION=knowledge_chunks
MONGODB_KNOWLEDGE_VECTOR_INDEX=knowledge_embedding_index
MONGODB_EMBEDDING_CACHE_COLLECTION=embedding_cache
MONGODB_POST_LOGS_COLLECTION=post_logs
MONGODB_MESSAGE_DEDUPE_COLLECTION=processed_messages
MONGODB_COMMENT_DEDUPE_COLLECTION=processed_comments
MONGODB_PENDING_REPLIES_COLLECTION=pending_replies
MONGODB_TOPICS_COLLECTION=topics
MONGODB_LEADS_COLLECTION=leads

# Messenger tuning (optional, defaults shown)
MESSENGER_REPLY_DEBOUNCE_MS=20000
MESSENGER_ADMIN_PAUSE_MS=600000
MESSENGER_REPLY_POLL_MS=10000
MESSENGER_REPLY_CONCURRENCY=3
MESSENGER_REPLY_LEASE_MS=300000
MESSENGER_REPLY_RETRY_MS=60000
MESSENGER_PENDING_MESSAGE_LIMIT=20

# Comment polling fallback (optional, defaults shown)
COMMENT_POLL_MS=60000
COMMENT_POLL_POSTS_LIMIT=5
COMMENT_POLL_COMMENTS_LIMIT=25

# Admin dashboard / CORS / monitoring (optional)
ADMIN_DASHBOARD_JWT_SECRET=
ADMIN_DASHBOARD_PASSWORD=
CORS_ORIGIN=http://localhost:5173
REQUIRE_POST_APPROVAL=false
SENTRY_DSN=

# Webhook rate limiting (optional, defaults shown) + reverse-proxy awareness
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
TRUST_PROXY_HOPS=0

# Google Sheets lead sync (optional — see "Google Sheets Lead Sync" below)
GOOGLE_SHEETS_SPREADSHEET_ID=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
GOOGLE_SHEETS_SHEET_NAME=Leads
```

---

## 🔑 Facebook App & Webhook Setup

1. **Create the app**: [Meta for Developers](https://developers.facebook.com/) → My Apps → Create App → add the _Messenger_ and _Webhooks_ products.
2. **Request permissions**: `pages_manage_posts`, `pages_messaging`, `pages_read_engagement`, `pages_show_list`.
3. **Page ID / App Secret**: Page → About → Page ID; App Dashboard → App Settings → Basic → App Secret.
4. **Long-lived Page access token**: Graph API Explorer → select the Page → generate a token with the permissions above → extend it via the [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken/).
5. **Local tunneling**: expose port 3000, e.g. `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`.
6. **Webhook subscription**: App Dashboard → Webhooks → Page → Callback URL `https://<your-tunnel>/webhook`, Verify Token = `FB_VERIFY_TOKEN`. Subscribe to `messages`, `messaging_postbacks`, `message_echoes`, `feed`.
7. Messenger → Settings → Webhooks → subscribe your Page.

---

## 🧠 Customizing the Knowledge Base

Edit `apps/backend/knowledge-base.json` with your business details (name, services, selling points, pricing policy, lead questions, reply style, fallback reply). On startup, `initDatabase()` (`src/integrations/mongo/db-init.ts`) chunks and syncs it into MongoDB automatically — only chunks whose content actually changed are re-embedded.

For MongoDB Atlas Vector Search, create indexes named `knowledge_embedding_index` (on `knowledge_chunks`, field `embedding`) and `conversation_embedding_index` (on `conversation_messages`) with the dimensions matching your `GEMINI_EMBEDDING_MODEL` output and cosine similarity.

---

## 🛠️ Admin Dashboard

A private web UI (`apps/admin-dashboard/`, a separate Vite + React + TypeScript project) for:

- **Post approval** — when `REQUIRE_POST_APPROVAL=true`, review/approve/reject the daily draft before it's published.
- **Conversation log** — browse Messenger conversations, and manually pause/resume the AI for a given user (the human-handoff mechanism the app already uses internally, exposed as a button).
- **Knowledge base editor** — view/edit `knowledge-base.json` and trigger an immediate re-sync, without shell/file access to the server.
- **Analytics** — post-performance leaderboard (likes/comments/shares per recent post, via the `pages_read_engagement` permission already granted — no `read_insights`/impressions/reach) and lead/sale conversion tracking (mark a conversation as a lead or sale from its detail page, see the conversion rate on the Analytics page).

### Backend setup

Set these in the backend's `apps/backend/.env` (all already listed above):

```env
ADMIN_DASHBOARD_PASSWORD=choose-a-strong-shared-password
ADMIN_DASHBOARD_JWT_SECRET=a-long-random-string
CORS_ORIGIN=http://localhost:5173   # the dashboard's dev/deploy origin
REQUIRE_POST_APPROVAL=false         # set true to gate daily posts behind approval
```

Without `ADMIN_DASHBOARD_PASSWORD`/`ADMIN_DASHBOARD_JWT_SECRET` set, `/admin/login` responds `503` rather than crashing the app — the rest of the automation is unaffected either way.

### Running the dashboard

```bash
# from the repo root, once (installs deps for both apps into one lockfile):
npm install

cd apps/admin-dashboard
cp .env.example .env   # set VITE_API_BASE_URL if the backend isn't on localhost:3000

npm run dev             # http://localhost:5173, talks to the backend over CORS
npm run build            # production build (dist/) — deploy as a static site, separately from the backend
```

The dashboard is a fully separate deploy target — it only needs network access to the backend's `/admin` API (CORS-gated) and never touches Mongo/Facebook/Gemini directly.

---

## 📊 Google Sheets Lead Sync

Optional, zero-cost "CRM" export: every lead (AI-extracted requirements from `modules/messenger/lead-extraction.service.ts`, plus the admin's manual status/note) is mirrored to one row in a Google Sheet — so the business owner gets a familiar, shareable view without opening the admin dashboard. Fully optional; unset, `syncLeadToSheet()` (`modules/messenger/lead-sheet-sync.service.ts`) silently no-ops.

This uses a **service account**, not OAuth — no per-user consent flow, and free.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or reuse one) and enable the **Google Sheets API**.
2. Create a **service account** (IAM & Admin → Service Accounts) and generate a JSON key.
3. From that key file, take `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `private_key` → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (paste as one line — the app un-escapes `\n` automatically).
4. Create a Google Sheet, copy its ID from the URL (`.../d/<SPREADSHEET_ID>/edit`) → `GOOGLE_SHEETS_SPREADSHEET_ID`.
5. Share that Sheet with the service account's email (from step 3) as **Editor**.

The target worksheet (`GOOGLE_SHEETS_SHEET_NAME`, default `Leads`) is created automatically on first sync if it doesn't exist yet, with a fixed header row (`userId, status, note, contactName, contactPhone, businessType, hasExistingWebsite, pageCount, features, deadline, referenceWebsite, budgetHint, updatedAt`).

---

## 🚀 Running the Project

```bash
npm install   # installs deps for both apps/backend and apps/admin-dashboard (one lockfile)

# Development (auto-reload)
npm run dev

# Production
npm run build
npm start
```

Use a process manager (PM2, Docker, systemd) to keep the process alive in production, e.g. `pm2 start dist/index.js --name social-ops-ai-automation`.

### Docker

A multi-stage `Dockerfile` (build → prune dev deps → minimal `node:20-alpine` runtime) and a `docker-compose.yml` (app + a local MongoDB, for convenience — no Atlas Vector Search, so RAG falls back to text-only search) are provided. `knowledge-base.json` is bind-mounted into the container so an edit made via the [Admin Dashboard](#️-admin-dashboard) persists across restarts (the image otherwise only `COPY`s it at build time).

```bash
docker compose up -d --build
```

⚠️ **This loads your real `.env` into the container** (`env_file: apps/backend/.env`). The moment it starts, the daily-post cron, Messenger reply worker, and comment-polling worker all start running against your **actual** Facebook Page and Gemini account — there is no dry-run/staging mode yet. Only run this against a `.env` you're prepared to see take real, live action with (or point `FB_PAGE_ACCESS_TOKEN`/`GEMINI_API_KEY` at throwaway/test credentials first).

```bash
docker compose down   # stop and remove containers (mongo-data volume persists)
```

---

## 🧪 Testing & Quality

```bash
npm test            # run the Vitest suite once
npm run test:watch  # watch mode
npm run typecheck        # type-check src
npm run typecheck:tests  # type-check tests
npm run lint         # ESLint
npm run lint:fix      # ESLint --fix
npm run format        # Prettier write
npm run format:check  # Prettier check
```

Pre-commit hooks (Husky + lint-staged) run ESLint/Prettier on staged files automatically.

Current suite (`apps/backend/tests/unit`, `apps/backend/tests/integration`) covers prompt builders, the comment/message dedupe stores, the Messenger reply queue worker (debounce/claim/lease-reclaim race conditions), the Facebook webhook signature verifier, admin auth, the lead store, the post-engagement service, and webhook payload schema validation.

The admin dashboard has its own lint/typecheck/test/build, wired into the same root scripts: `npm run lint:dashboard`, `npm run typecheck:dashboard`, `npm run test:dashboard` (Vitest + jsdom — covers the API client's token storage and login flow), `npm run build:dashboard`.

---

## 🛡️ Reliability & Security Notes

- **Webhook signature verification**: `crypto.timingSafeEqual` HMAC-SHA256 check rejects tampered requests before any processing.
- **Retry policy**: `infra/retry.ts` backs off exponentially on Gemini `429`s and Graph API `5xx`/network errors.
- **Webhook rate limiting**: `/webhook` (both the verification `GET` and event `POST`) is rate-limited per client IP (`express-rate-limit`, `RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX_REQUESTS`) to blunt abuse/DoS against the public endpoint. If deployed behind a reverse proxy (nginx, Cloudflare Tunnel, a PaaS load balancer), set `TRUST_PROXY_HOPS=1` so it keys off the real client IP from `X-Forwarded-For` instead of the proxy's — otherwise all traffic shares one bucket.
- **Structured logging**: `infra/logger.ts` is backed by [pino](https://getpino.io/) — pretty-printed locally, raw NDJSON in production (`NODE_ENV=production`) for log aggregators. Level follows `LOG_LEVEL` (or forced to `debug` if `DEBUG` is set).
- **Error tracking**: set `SENTRY_DSN` to enable [Sentry](https://sentry.io/) (`infra/sentry.ts`) — captures uncaught exceptions/unhandled rejections (`index.ts`) and any error that reaches the Express error middleware (`server/http-server.ts`). Left unset, it silently no-ops — no code changes needed either way.
- **Admin dashboard auth**: `/admin/login` is rate-limited (`express-rate-limit`) against brute-forcing the shared password; the password itself is compared with `crypto.timingSafeEqual` (`modules/admin/auth.ts`), and every other `/admin/*` route requires a signed JWT. CORS on `/admin` is scoped to `CORS_ORIGIN` only — unset, no cross-origin browser access is granted.
- **Data retention**: TTL indexes purge the embedding cache and post logs automatically (see index definitions in each model under `src/modules/*/`).
- **Graceful shutdown**: drains the HTTP server and closes the MongoDB connection on `SIGTERM`/`SIGINT`, with a forced-exit timeout as a safety net.
- **Degrades without Mongo**: if `MONGODB_URI` is unset, the knowledge store falls back to reading `knowledge-base.json` directly instead of crashing.

---

## 📄 License

ISC License.
