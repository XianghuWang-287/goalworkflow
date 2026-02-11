/**
 * Reset all state for a goal, then simulate 7 days of checkins
 * with realistic timestamps (one checkin per day, not all on the same day).
 *
 * Usage:
 *   npx tsx scripts/reset-and-simulate.ts                  # first active goal
 *   npx tsx scripts/reset-and-simulate.ts --goalId=xxx     # specific goal
 */

import { prisma, findActiveGoal, disconnect } from "./_helpers/db";
import { log } from "./_helpers/log";

const CHECKIN_PATTERN: Array<"done" | "partial" | "missed"> = [
  "done", "done", "done", "partial", "done", "done", "done",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const goalId = args.find((a) => a.startsWith("--goalId="))?.split("=")[1];
  return { goalId };
}

async function resetGoalState(goalId: string) {
  // Delete in dependency order
  const checkins = await prisma.checkin.deleteMany({ where: { goalId } });
  const reviews = await prisma.weeklyReview.deleteMany({ where: { goalId } });
  const badges = await prisma.badge.deleteMany({ where: { goalId } });
  const events = await prisma.eventLog.deleteMany({ where: { goalId } });

  // Reset task statuses back to pending
  const tasks = await prisma.task.updateMany({
    where: { goalId },
    data: { status: "pending", completedAt: null },
  });

  // Superseded plans → reactivate latest, reset week/phase
  const plans = await prisma.plan.findMany({
    where: { goalId },
    orderBy: { version: "desc" },
  });

  if (plans.length > 0) {
    // Set all to superseded first
    await prisma.plan.updateMany({
      where: { goalId },
      data: { status: "superseded" },
    });
    // Reactivate the latest one, reset to week 0 phase 0
    await prisma.plan.update({
      where: { id: plans[0].id },
      data: { status: "active", currentWeek: 0, currentPhase: 0 },
    });
  }

  log.warn(`Cleaned: ${checkins.count} checkins, ${reviews.count} reviews, ${badges.count} badges, ${events.count} events`);
  log.warn(`Reset ${tasks.count} tasks to pending, reactivated latest plan`);
}

async function main() {
  const { goalId } = parseArgs();

  log.info("Finding active goal...");
  const goal = await findActiveGoal(goalId);
  if (!goal) process.exit(1);

  log.success(`Goal: ${goal.title} (${goal.id})`);
  log.dim(`User: ${goal.user.email}`);

  // Step 1: Reset all state
  log.info("Resetting all state...");
  await resetGoalState(goal.id);

  // Step 2: Re-fetch goal with active plan to get plan day dates
  const freshGoal = await prisma.goal.findFirst({
    where: { id: goal.id },
    include: {
      plans: { where: { status: "active" }, take: 1 },
      tasks: { orderBy: { date: "asc" } },
    },
  });

  // Use plan day.date strings (YYYY-MM-DD) — these are what the UI renders
  const planJson = freshGoal!.plans[0]?.planJson as any;
  const week0Days: string[] =
    planJson?.weeks?.[0]?.days?.map((d: any) => d.date) ?? [];

  // Fallback to local task dates if no plan days
  const dayDates =
    week0Days.length > 0
      ? week0Days.slice(0, 7)
      : [
          ...new Set(
            freshGoal!.tasks.map((t) => {
              const d = new Date(t.date);
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            })
          ),
        ]
          .sort()
          .slice(0, 7);

  if (dayDates.length === 0) {
    log.error("No plan days or tasks found — nothing to simulate");
    process.exit(1);
  }

  log.info(
    `Plan dates: ${dayDates[0]} → ${dayDates[dayDates.length - 1]} (${dayDates.length} days)`
  );

  // Step 3: Create checkins with realistic per-day timestamps
  log.info("Creating checkins with per-day timestamps...");
  for (let i = 0; i < dayDates.length; i++) {
    const status = CHECKIN_PATTERN[i % CHECKIN_PATTERN.length];
    const dateStr = dayDates[i]; // "YYYY-MM-DD" from plan

    // Parse as local date parts to avoid timezone shift
    const [y, m, d] = dateStr.split("-").map(Number);

    // Simulate checking in at a random time that day (8am-10pm)
    const hour = 8 + Math.floor(Math.random() * 14);
    const minute = Math.floor(Math.random() * 60);
    const checkinMoment = new Date(y, m - 1, d, hour, minute, 0);

    // Checkin date (local midnight, for DB unique constraint)
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

    // Update tasks for that day — match any task within ±12h of local midnight
    const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
    const dayEnd = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
    const taskStatus =
      status === "done" ? "done" : status === "partial" ? "partial" : "missed";
    await prisma.task.updateMany({
      where: {
        goalId: goal.id,
        date: { gte: dayStart, lt: dayEnd },
      },
      data: {
        status: taskStatus,
        completedAt: status === "done" ? checkinMoment : null,
      },
    });

    // EventLog with realistic timestamp
    await prisma.eventLog.create({
      data: {
        goalId: goal.id,
        type: "checkin",
        payloadJson: {
          checkinId: checkin.id,
          status,
          date: dateStr,
          createdVia: "script",
        },
        createdAt: checkinMoment,
      },
    });

    const icon = status === "done" ? "✓" : status === "partial" ? "◐" : "✗";
    log.dim(
      `  ${dateStr}  ${icon} ${status}  (at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")})`
    );
  }

  const summary = { done: 0, partial: 0, missed: 0 };
  for (let i = 0; i < dayDates.length; i++) {
    summary[CHECKIN_PATTERN[i % CHECKIN_PATTERN.length]]++;
  }

  log.success(
    `Simulation complete — Done: ${summary.done}  Partial: ${summary.partial}  Missed: ${summary.missed}`
  );
  log.info("Refresh the goal detail page to see the results.");
}

main()
  .catch((e) => {
    log.error(e.message);
    process.exit(1);
  })
  .finally(() => disconnect());
