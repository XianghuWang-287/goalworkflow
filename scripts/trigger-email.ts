/**
 * Trigger email sending from CLI.
 *
 * Usage:
 *   npx tsx scripts/trigger-email.ts daily                # send all daily checkin emails
 *   npx tsx scripts/trigger-email.ts weekly               # send all weekly review emails
 *   npx tsx scripts/trigger-email.ts weekly --goalId=xxx  # specific goal
 *   npx tsx scripts/trigger-email.ts daily --goalId=xxx   # specific goal
 */

import { findActiveGoal, disconnect } from "./_helpers/db";
import { log } from "./_helpers/log";

function parseArgs() {
  const args = process.argv.slice(2);
  const type = args[0] as "daily" | "weekly" | undefined;
  const goalId = args.find((a) => a.startsWith("--goalId="))?.split("=")[1];
  return { type, goalId };
}

async function main() {
  const { type, goalId } = parseArgs();

  if (!type || !["daily", "weekly"].includes(type)) {
    log.error("Usage: trigger-email.ts <daily|weekly> [--goalId=xxx]");
    process.exit(1);
  }

  // Dynamic import to avoid loading email deps eagerly
  const email = await import("../lib/email/index");

  if (type === "daily") {
    if (goalId) {
      log.info(`Sending daily checkin email for goal ${goalId}...`);
      const result = await email.sendDailyCheckinEmail(goalId);
      result.success
        ? log.success(`Sent (${result.emailId})`)
        : log.error(result.error || "Unknown error");
    } else {
      log.info("Sending daily checkin emails to all active goals...");
      const results = await email.sendAllDailyCheckinEmails();
      log.success(`Sent: ${results.success}/${results.total}  Failed: ${results.failed}`);
    }
  }

  if (type === "weekly") {
    if (goalId) {
      log.info(`Sending weekly review email for goal ${goalId}...`);
      const result = await email.sendWeeklyReviewEmail(goalId);
      result.success
        ? log.success(`Sent (${result.emailId})`)
        : log.error(result.error || "Unknown error");
    } else {
      log.info("Sending weekly review emails to all active goals...");
      const results = await email.sendAllWeeklyReviewEmails();
      log.success(`Sent: ${results.success}/${results.total}  Failed: ${results.failed}`);
    }
  }
}

main()
  .catch((e) => { log.error(e.message); process.exit(1); })
  .finally(() => disconnect());
