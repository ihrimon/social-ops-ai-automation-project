import { logger } from "./infra/logger.js";
import { errorMessage } from "./infra/errors.js";
import { initSentry, captureException } from "./infra/sentry.js";
import { initDatabase } from "./integrations/mongo/db-init.js";
import { closeMongoClient } from "./integrations/mongo/client.js";
import { scheduleDailyPostJob } from "./jobs/daily-post-job.js";
import { scheduleWeeklyReportJob } from "./jobs/weekly-report-job.js";
import { startPendingReplyWorker } from "./jobs/pending-reply-worker.js";
import { startCommentPollWorker } from "./jobs/comment-poll-worker.js";
import { startWebhookServer } from "./server/http-server.js";

async function shutdown(
  signal: string,
  webhookServer: ReturnType<typeof startWebhookServer>
): Promise<void> {
  logger.info(`${signal} received. Shutting down gracefully...`);
  webhookServer.close(async () => {
    try {
      await closeMongoClient();
      logger.info("MongoDB connection closed.");
    } catch (err) {
      logger.error("Error closing MongoDB connection:", { error: errorMessage(err) });
    }
    process.exit(0);
  });

  // Force exit if server does not close within 10 seconds
  setTimeout(() => {
    logger.error("Forceful shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
}

async function bootstrap(): Promise<void> {
  initSentry();

  scheduleDailyPostJob();
  scheduleWeeklyReportJob();

  // Initialize Database connection, warm up indexes, and populate local knowledge cache
  await initDatabase().catch((err) => {
    logger.error(
      "Initial database configuration failed. Verification indexes and cache might not be fully configured:",
      { error: errorMessage(err) }
    );
  });

  startPendingReplyWorker();
  startCommentPollWorker();

  const webhookServer = startWebhookServer();

  process.on("SIGTERM", () => shutdown("SIGTERM", webhookServer));
  process.on("SIGINT", () => shutdown("SIGINT", webhookServer));

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection:", { reason });
    captureException(reason);
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception:", { error: error.message, stack: error.stack });
    captureException(error);
    void shutdown("uncaughtException", webhookServer);
  });
}

await bootstrap();
