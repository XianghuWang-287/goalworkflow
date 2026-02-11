/**
 * Simulate 7 days of checkins for the current week of a goal.
 * Uses plan day.date strings to avoid timezone issues.
 *
 * Usage:
 *   npx tsx scripts/simulate-week.ts                  # first active goal
 *   npx tsx scripts/simulate-week.ts --goalId=xxx    # specific goal
 */

import { prisma, findActiveGoal, disconnect } from "./_helpers/db";
import { log } from "./_helpers/log";

// 6 done + 1 partial = good enough for review button
const CHECKIN_PATTERN: Array<"done" | "partial" | "missed"> = [
  "done", "done", "done", "partial", "done", "done", "done",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const goalId = args.find((a) => a.startsWith("--goalId="))?.split("=")[1];
  return { goalId };
}

async function main() {
  const { goalId } = parseArgs();

  log.info("Finding active goal...");
  const goal = await findActiveGoal(goalId);
  if (!goal) process.exit(1);

  log.success(`Goal: ${goal.title} (${goal.id})`);
  log.dim(`User: ${goal.user.email}`);

  // Get active plan
  const activePlan = goal.plans[0];
  if (!activePlan) {
    log.error("No active plan found");
    process.exit(1);
  }

  const planJson = activePlan.planJson as any;
  const currentWeekIdx = activePlan.currentWeek ?? 0;
  const currentWeek = planJson?.weeks?.[currentWeekIdx];

  if (!currentWeek?.days?.length) {
    log.error(`No days found in week ${currentWeekIdx}`);
    process.exit(1);
  }

  const dayDates: string[] = currentWeek.days.map((d: any) => d.date).slice(0, 7);
  log.info(`Week ${currentWeekIdx} dates: ${dayDates[0]} → ${dayDates[dayDates.length - 1]}`);

  // Create checkins
  log.info("Creating checkins...");
  for (let i = 0; i < dayDates.length; i++) {
    const status = CHECKIN_PATTERN[i % CHECKIN_PATTERN.length];
    const dateStr = dayDates[i];

    // Parse as local date
    const [y, m, d] = dateStr.split("-").map(Number);
    const hour = 8 + Math.floor(Math.random() * 14);
    const minute = Math.floor(Math.random() * 60);
    const checkinMoment = new Date(y, m - 1, d, hour, minute, 0);
    const checkinDate = new Date(y, m - 1, d, 0, 0, 0, 0);

    // Upsert checkin
    const checkin = await prisma.checkin.upsert({
      where: { goalId_date: { goalId: goal.id, date: checkinDate } },
      update: { status, createdVia: "script" },
      create: {
        goalId: goal.id,
        date: checkinDate,
        status,
        createdVia: "script",
        createdAt: checkinMoment,
      },
    });

    // Update tasks for that day
    const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
    const dayEnd = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
    const taskStatus = status === "done" ? "done" : status === "partial" ? "partial" : "missed";
    await prisma.task.updateMany({
      where: { goalId: goal.id, date: { gte: dayStart, lt: dayEnd } },
      data: { status: taskStatus, completedAt: status === "done" ? checkinMoment : null },
    });

    // EventLog
    await prisma.eventLog.create({
      data: {
        goalId: goal.id,
        type: "checkin",
        payloadJson: { checkinId: checkin.id, status, date: dateStr, createdVia: "script" },
        createdAt: checkinMoment,
      },
    });

    const icon = status === "done" ? "✓" : status === "partial" ? "◐" : "✗";
    log.dim(`  ${dateStr}  ${icon} ${status}  (at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")})`);
  }

  const summary = { done: 0, partial: 0, missed: 0 };
  for (let i = 0; i < dayDates.length; i++) {
    summary[CHECKIN_PATTERN[i % CHECKIN_PATTERN.length]]++;
  }

  log.success(`Done: ${summary.done}  Partial: ${summary.partial}  Missed: ${summary.missed}`);
  log.info("Refresh the goal detail page to test the weekly review flow");
}

main()
  .catch((e) => {
    log.error(e.message);
    process.exit(1);
  })
  .finally(() => disconnect());
