import cron from "node-cron";
import { logger } from "../infra/logger.js";
import { errorMessage } from "../infra/errors.js";
import { isTelegramConfigured, sendTelegramAlert } from "../integrations/telegram/client.js";
import { listPostLogs } from "../modules/content/post-log.store.js";
import { extractFacebookPostId, getPostEngagement } from "../modules/content/engagement.service.js";
import { getRecentLeadStats } from "../modules/messenger/lead.store.js";
import { getWeeklyMessageStats } from "../modules/messenger/conversation.store.js";

const TIMEZONE = "Asia/Dhaka";
const WEEKLY_REPORT_TIME = "0 9 * * 0"; // Sunday 9am
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Builds and sends the weekly Telegram digest: posts published + engagement, new
 * leads/sales, and customer message volume by channel — reusing the same
 * TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID already configured for urgency alerts.
 * Best-effort: a failure anywhere in here is logged, never thrown — a report
 * that doesn't go out this week must never crash the process.
 */
export async function runWeeklyReportJob(): Promise<void> {
  if (!isTelegramConfigured()) {
    return;
  }

  try {
    const since = new Date(Date.now() - WEEK_MS);

    const recentPosts = (await listPostLogs({ status: "posted", limit: 50 })).filter(
      (post: any) => post.createdAt && new Date(post.createdAt) >= since
    );

    const engagementTotals = { likes: 0, comments: 0, shares: 0 };
    for (const post of recentPosts as any[]) {
      const postId = extractFacebookPostId(post.facebookResponse);
      const engagement = postId ? await getPostEngagement(postId) : null;
      if (engagement) {
        engagementTotals.likes += engagement.likes;
        engagementTotals.comments += engagement.comments;
        engagementTotals.shares += engagement.shares;
      }
    }

    const [leadStats, messageStats] = await Promise.all([
      getRecentLeadStats(since),
      getWeeklyMessageStats(since),
    ]);

    const messageLines =
      Object.entries(messageStats)
        .map(([platform, count]) => `  - ${platform}: ${count}`)
        .join("\n") || "  - none";

    const report = [
      "📊 Weekly report",
      "",
      `Posts published: ${recentPosts.length}`,
      `Engagement: ${engagementTotals.likes} likes, ${engagementTotals.comments} comments, ${engagementTotals.shares} shares`,
      "",
      "Customer messages this week:",
      messageLines,
      "",
      `New leads: ${leadStats.leads}`,
      `New sales: ${leadStats.sales}`,
    ].join("\n");

    await sendTelegramAlert(report);
    logger.info("Weekly report sent via Telegram.");
  } catch (error) {
    logger.error("Weekly report job failed:", { error: errorMessage(error) });
  }
}

/** Schedules the weekly Telegram digest. No-ops (and logs once) if Telegram isn't configured. */
export function scheduleWeeklyReportJob(): void {
  if (!isTelegramConfigured()) {
    logger.info("Weekly report job disabled: Telegram is not configured.");
    return;
  }

  cron.schedule(
    WEEKLY_REPORT_TIME,
    async () => {
      logger.info(`Weekly report job triggered (cron: "${WEEKLY_REPORT_TIME}" ${TIMEZONE}).`);
      await runWeeklyReportJob();
    },
    { timezone: TIMEZONE }
  );

  logger.info(`Weekly report scheduled via cron "${WEEKLY_REPORT_TIME}" (${TIMEZONE}).`);
}
