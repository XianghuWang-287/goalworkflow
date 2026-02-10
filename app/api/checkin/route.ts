/**
 * Check-in API
 * POST /api/checkin - Create a check-in (authenticated)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAndAwardCheckinBadges } from "@/lib/badges";
import { z } from "zod";

const CheckinSchema = z.object({
  goalId: z.string(),
  status: z.enum(["done", "partial", "missed"]),
  note: z.string().optional(),
  date: z.string().optional(), // ISO date string, defaults to today
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = CheckinSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { goalId, status, note, date } = parsed.data;

    // Verify goal belongs to user
    const goal = await prisma.goal.findFirst({
      where: {
        id: goalId,
        userId: session.user.id,
      },
    });

    if (!goal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    // Use provided date or today
    const checkinDate = date ? new Date(date) : new Date();
    checkinDate.setHours(0, 0, 0, 0);

    // Upsert check-in (allow updating existing check-in for same date)
    const checkin = await prisma.checkin.upsert({
      where: {
        goalId_date: {
          goalId,
          date: checkinDate,
        },
      },
      update: {
        status,
        note,
        createdVia: "web",
      },
      create: {
        goalId,
        date: checkinDate,
        status,
        note,
        createdVia: "web",
      },
    });

    // Update task statuses for today
    await prisma.task.updateMany({
      where: {
        goalId,
        date: checkinDate,
      },
      data: {
        status: status === "done" ? "done" : status === "partial" ? "partial" : "missed",
        completedAt: status === "done" ? new Date() : null,
      },
    });

    // Log event
    await prisma.eventLog.create({
      data: {
        goalId,
        type: "checkin",
        payloadJson: {
          checkinId: checkin.id,
          status,
          date: checkinDate.toISOString(),
          createdVia: "web",
        },
      },
    });

    // Check and award badges
    const newBadges = await checkAndAwardCheckinBadges(session.user.id, goalId);

    return NextResponse.json({
      success: true,
      checkin,
      newBadges: newBadges.length > 0 ? newBadges : undefined,
    });
  } catch (error) {
    console.error("Check-in error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET /api/checkin?goalId=xxx - Get check-ins for a goal
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const goalId = searchParams.get("goalId");

    if (!goalId) {
      return NextResponse.json({ error: "goalId required" }, { status: 400 });
    }

    // Verify goal belongs to user
    const goal = await prisma.goal.findFirst({
      where: {
        id: goalId,
        userId: session.user.id,
      },
    });

    if (!goal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    const checkins = await prisma.checkin.findMany({
      where: { goalId },
      orderBy: { date: "desc" },
      take: 30,
    });

    return NextResponse.json({ checkins });
  } catch (error) {
    console.error("Get check-ins error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
