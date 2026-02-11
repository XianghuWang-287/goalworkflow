import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { log } from "./log";

export const prisma = new PrismaClient();

export async function findActiveGoal(goalId?: string) {
  const where = goalId
    ? { id: goalId, status: "active" }
    : { status: "active" as const };

  const goal = await prisma.goal.findFirst({
    where,
    include: {
      user: true,
      plans: { where: { status: "active" }, take: 1 },
      checkins: { orderBy: { date: "desc" as const }, take: 30 },
      tasks: { orderBy: { date: "asc" as const } },
    },
  });

  if (!goal) {
    log.error(goalId ? `Goal ${goalId} not found or not active` : "No active goals found");
    return null;
  }

  return goal;
}

export async function listActiveGoals() {
  return prisma.goal.findMany({
    where: { status: "active" },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Create a checkin, mirroring the logic in app/api/checkin/route.ts:
 * upsert checkin → updateMany tasks → create EventLog
 */
export async function createCheckin(
  goalId: string,
  date: Date,
  status: "done" | "partial" | "missed",
  note?: string
) {
  const checkinDate = new Date(date);
  checkinDate.setHours(0, 0, 0, 0);

  const checkin = await prisma.checkin.upsert({
    where: { goalId_date: { goalId, date: checkinDate } },
    update: { status, note, createdVia: "script" },
    create: { goalId, date: checkinDate, status, note, createdVia: "script" },
  });

  await prisma.task.updateMany({
    where: { goalId, date: checkinDate },
    data: {
      status: status === "done" ? "done" : status === "partial" ? "partial" : "missed",
      completedAt: status === "done" ? new Date() : null,
    },
  });

  await prisma.eventLog.create({
    data: {
      goalId,
      type: "checkin",
      payloadJson: {
        checkinId: checkin.id,
        status,
        date: checkinDate.toISOString(),
        createdVia: "script",
      },
    },
  });

  return checkin;
}

/**
 * Clean checkins for a goal on specific dates
 */
export async function cleanCheckinsForDates(goalId: string, dates: Date[]) {
  const deleted = await prisma.checkin.deleteMany({
    where: { goalId, date: { in: dates } },
  });
  return deleted.count;
}

/**
 * Clean checkins for a goal within a date range (defaults to last 7 days)
 */
export async function cleanCheckins(goalId: string, days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const deleted = await prisma.checkin.deleteMany({
    where: { goalId, date: { gte: since } },
  });

  return deleted.count;
}

export async function disconnect() {
  await prisma.$disconnect();
}
