# Test Scripts & allCheckedIn Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create two separate test scripts (reset-goal.ts, simulate-week.ts) and fix allCheckedIn logic to allow testing the full weekly review flow without waiting for the actual week to end.

**Architecture:** Two scripts using existing `_helpers/db.ts` and `_helpers/log.ts`. The reset script restores a goal to "just created first plan" state. The simulate script creates 7 checkins matching plan day.date strings. The page fix changes allCheckedIn from "all days elapsed" to "all elapsed days have checkins".

**Tech Stack:** TypeScript, Prisma, existing script helpers

---

### Task 1: Create reset-goal.ts script

**Files:**
- Create: `scripts/reset-goal.ts`

**Step 1: Create the reset script**

```ts
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
      // Delete tasks that belong to superseded plans
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
```

**Step 2: Verify script runs**

Run: `npx tsx scripts/reset-goal.ts`
Expected: Script finds goal, deletes data, reactivates original plan

**Step 3: Commit**

```bash
git add scripts/reset-goal.ts
git commit -m "feat: add reset-goal.ts script to restore goal to initial state"
```

---

### Task 2: Create simulate-week.ts script

**Files:**
- Create: `scripts/simulate-week.ts`

**Step 1: Create the simulate script**

```ts
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
    await prisma.task.updateMany({
      where: {
        goalId: goal.id,
        date: { gte: dayStart, lt: dayEnd },
      },
      data: {
        status: status === "done" ? "done" : status === "partial" ? "partial" : "missed",
        completedAt: status === "done" ? checkinMoment : null,
      },
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
  log.info("Refresh the goal detail page to see results");
}

main()
  .catch((e) => {
    log.error(e.message);
    process.exit(1);
  })
  .finally(() => disconnect());
```

**Step 2: Verify script runs**

Run: `npx tsx scripts/simulate-week.ts`
Expected: Creates 7 checkins matching plan dates

**Step 3: Commit**

```bash
git add scripts/simulate-week.ts
git commit -m "feat: add simulate-week.ts script for testing weekly review flow"
```

---

### Task 3: Fix allCheckedIn logic in goal detail page

**Files:**
- Modify: `app/goals/[id]/page.tsx:161-164`

**Step 1: Change allCheckedIn condition**

Current logic (lines 161-164):
```ts
const allCheckedIn =
  elapsedDays.length >= totalWeekDays &&
  elapsedWithCheckin.length >= totalWeekDays &&
  totalWeekDays > 0;
```

New logic:
```ts
// Show review button when all elapsed days have checkins
// (allows testing without waiting for week to end)
const allCheckedIn =
  elapsedDays.length > 0 &&
  elapsedWithCheckin.length >= elapsedDays.length;
```

This changes from "all week days must have elapsed AND all have checkins" to "all elapsed days have checkins (at least 1 day elapsed)".

**Step 2: Verify in browser**

1. Run `npx tsx scripts/reset-goal.ts`
2. Run `npx tsx scripts/simulate-week.ts`
3. Refresh goal detail page
4. Weekly Review button should appear

**Step 3: Commit**

```bash
git add app/goals/[id]/page.tsx
git commit -m "fix: allCheckedIn shows review button when all elapsed days have checkins"
```

---

### Task 4: Add npm scripts for convenience

**Files:**
- Modify: `package.json`

**Step 1: Add scripts**

Add to `scripts` section:
```json
"goal:reset": "tsx scripts/reset-goal.ts",
"goal:simulate": "tsx scripts/simulate-week.ts"
```

**Step 2: Verify**

Run: `npm run goal:reset && npm run goal:simulate`
Expected: Both scripts run successfully

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add npm scripts for goal:reset and goal:simulate"
```

---

### Task 5: Integration test

**Step 1: Full flow test**

```bash
npm run goal:reset
npm run goal:simulate
```

**Step 2: Manual verification**

1. Open goal detail page in browser
2. Verify all 7 day cards show status (✓/◐)
3. Verify "Weekly Review" button appears
4. Click button → review page loads
5. Choose an option → redirects back
6. Verify button is gone, history card shows review

**Step 3: Final commit**

```bash
git add -A
git commit -m "docs: add test scripts plan"
```
