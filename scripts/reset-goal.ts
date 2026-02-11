/**
 * Completely reset a goal to initial state (just after first plan generation).
 *
 * Usage:
 *   npx tsx scripts/reset-goal.ts                  # first active goal
 *   npx tsx scripts/reset-goal.ts --goalId=xxx    # specific goal
 */

import { prisma, findActiveGoal, disconnect } from "./_helpers/db";
import { log } from "./_helpers/log";

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

  log.info("Resetting to initial state...");

  // Delete all related data
  const checkins = await prisma.checkin.deleteMany({ where: { goalId: goal.id } });
  const reviews = await prisma.weeklyReview.deleteMany({ where: { goalId: goal.id } });
  const badges = await prisma.badge.deleteMany({ where: { goalId: goal.id } });
  const events = await prisma.eventLog.deleteMany({ where: { goalId: goal.id } });

  log.dim(`  Deleted: ${checkins.count} checkins, ${reviews.count} reviews, ${badges.count} badges, ${events.count} events`);

  // Reset all tasks to pending
  const tasks = await prisma.task.updateMany({
    where: { goalId: goal.id },
    data: { status: "pending", completedAt: null },
  });
  log.dim(`  Reset ${tasks.count} tasks to pending`);

  // Find all plans, reactivate version 1 (original), supersede others
  const plans = await prisma.plan.findMany({
    where: { goalId: goal.id },
    orderBy: { version: "asc" },
  });

  if (plans.length > 0) {
    // Supersede all plans first
    await prisma.plan.updateMany({
      where: { goalId: goal.id },
      data: { status: "superseded" },
    });

    // Reactivate version 1 (the original plan)
    const originalPlan = plans[0];
    await prisma.plan.update({
      where: { id: originalPlan.id },
      data: { status: "active", currentWeek: 0, currentPhase: 0 },
    });

    log.dim(`  Reactivated plan v${originalPlan.version}, superseded ${plans.length - 1} other(s)`);

    // Delete tasks from later plans and recreate from original plan
    if (plans.length > 1) {
      const laterPlanIds = plans.slice(1).map((p) => p.id);
      const deletedTasks = await prisma.task.deleteMany({
        where: { goalId: goal.id, planId: { in: laterPlanIds } },
      });
      log.dim(`  Deleted ${deletedTasks.count} tasks from superseded plans`);
    }
  }

  log.success("Goal reset to initial state");
  log.info("Run `npx tsx scripts/simulate-week.ts` to create test checkins");
}

main()
  .catch((e) => {
    log.error(e.message);
    process.exit(1);
  })
  .finally(() => disconnect());
