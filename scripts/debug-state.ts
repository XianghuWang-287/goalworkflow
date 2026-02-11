import dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  const goal = await p.goal.findFirst({ where: { status: "active" } });
  if (!goal) { console.log("No active goal"); return; }
  console.log("Goal:", goal.id);

  const tasks = await p.task.findMany({
    where: { goalId: goal.id },
    orderBy: { date: "asc" },
    select: { id: true, date: true, status: true, planId: true, taskJson: true },
  });
  const today = new Date().toISOString().slice(0, 10);
  const todayTasks = tasks.filter(t => t.date.toISOString().slice(0, 10) === today);
  console.log("\n=== TODAY TASKS (" + today + ") ===");
  console.log("Count:", todayTasks.length);
  todayTasks.forEach(t => {
    const meta = t.taskJson as any;
    console.log(" ", t.id.slice(0, 8), t.status, "plan:" + (t.planId?.slice(0, 8) ?? "null"), meta?.title?.slice(0, 50));
  });

  const plans = await p.plan.findMany({
    where: { goalId: goal.id },
    select: { id: true, version: true, status: true },
    orderBy: { version: "desc" },
  });
  console.log("\n=== PLANS ===");
  plans.forEach(pl => console.log(" ", pl.id.slice(0, 8), "v" + pl.version, pl.status));

  const checkins = await p.checkin.findMany({
    where: { goalId: goal.id },
    orderBy: { date: "asc" },
    select: { date: true, status: true },
  });
  console.log("\n=== CHECKINS ===");
  checkins.forEach(c => console.log(" ", c.date.toISOString(), c.status));

  const activePlan = plans.find(p => p.status === "active");
  if (activePlan) {
    const fullPlan = await p.plan.findUnique({ where: { id: activePlan.id }, select: { planJson: true } });
    const planData = fullPlan?.planJson as any;
    console.log("\n=== ACTIVE PLAN DAY DATES ===");
    planData?.weeks?.forEach((w: any) => {
      w.days?.forEach((d: any) => {
        console.log("  Week", w.week_index, "Day", d.day_index, d.date);
      });
    });
  }

  // Tasks grouped by planId
  const planIds = [...new Set(tasks.map(t => t.planId))];
  console.log("\n=== TASKS BY PLAN ===");
  for (const pid of planIds) {
    const count = tasks.filter(t => t.planId === pid).length;
    const plan = plans.find(p => p.id === pid);
    console.log("  Plan", pid?.slice(0, 8), "(" + (plan?.status ?? "?") + " v" + (plan?.version ?? "?") + "):", count, "tasks");
  }
}

main().finally(() => p.$disconnect());
