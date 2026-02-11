/**
 * Simulate 7 days of checkins for testing weekly review flow.
 *
 * Usage:
 *   npx tsx scripts/simulate-checkins.ts                  # default: first active goal
 *   npx tsx scripts/simulate-checkins.ts --goalId=xxx     # specific goal
 *   npx tsx scripts/simulate-checkins.ts --review         # also trigger weekly review email
 */

import { findActiveGoal, createCheckin, cleanCheckinsForDates, disconnect } from "./_helpers/db";
import { log } from "./_helpers/log";

const CHECKIN_PATTERN: Array<"done" | "partial" | "missed"> = [
  "done", "done", "done", "partial", "done", "missed", "done",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const goalId = args.find((a) => a.startsWith("--goalId="))?.split("=")[1];
  const review = args.includes("--review");
  return { goalId, review };
}

async function main() {
  const { goalId, review } = parseArgs();

  log.info("Finding active goal...");
  const goal = await findActiveGoal(goalId);
  if (!goal) process.exit(1);

  log.success(`Goal: ${goal.title} (${goal.id})`);
  log.dim(`User: ${goal.user.email}`);

  // Extract unique task dates from the plan (sorted asc)
  const taskDates = [...new Set(goal.tasks.map((t) => t.date.toISOString().slice(0, 10)))]
    .sort()
    .slice(0, 7)
    .map((d) => { const dt = new Date(d); dt.setHours(0, 0, 0, 0); return dt; });

  if (taskDates.length === 0) {
    log.error("No tasks found for this goal — nothing to checkin");
    process.exit(1);
  }

  log.info(`Found ${taskDates.length} task dates: ${taskDates[0].toISOString().slice(0, 10)} → ${taskDates[taskDates.length - 1].toISOString().slice(0, 10)}`);

  // Clean existing checkins for those dates (idempotent)
  const cleaned = await cleanCheckinsForDates(goal.id, taskDates);
  if (cleaned > 0) log.warn(`Cleaned ${cleaned} existing checkins`);

  // Create checkins for each task date
  log.info(`Creating ${taskDates.length} checkins...`);
  for (let i = 0; i < taskDates.length; i++) {
    const date = taskDates[i];
    const status = CHECKIN_PATTERN[i % CHECKIN_PATTERN.length];
    await createCheckin(goal.id, date, status);
    const label = date.toISOString().slice(0, 10);
    const icon = status === "done" ? "✓" : status === "partial" ? "◐" : "✗";
    log.dim(`  ${label}  ${icon} ${status}`);
  }

  const summary = { done: 0, partial: 0, missed: 0 };
  for (let i = 0; i < taskDates.length; i++) {
    summary[CHECKIN_PATTERN[i % CHECKIN_PATTERN.length]]++;
  }
  log.success(`Done: ${summary.done}  Partial: ${summary.partial}  Missed: ${summary.missed}`);

  if (review) {
    log.info("Triggering weekly review email...");
    // Dynamic import to avoid loading email deps unless needed
    const { sendWeeklyReviewEmail } = await import("../lib/email/index");
    const result = await sendWeeklyReviewEmail(goal.id);
    if (result.success) {
      log.success(`Weekly review email sent (${result.emailId})`);
    } else {
      log.error(`Failed to send: ${result.error}`);
    }
  }
}

main()
  .catch((e) => { log.error(e.message); process.exit(1); })
  .finally(() => disconnect());
