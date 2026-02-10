/**
 * Token-based Check-in API
 * POST /api/checkin/token - Create a check-in via OneTimeToken (no auth required)
 * GET /api/checkin/token?token=xxx - Validate token and get goal info
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAndConsumeToken, markTokenUsed } from "@/lib/tokens";
import { checkAndAwardCheckinBadges } from "@/lib/badges";
import { z } from "zod";

const TokenCheckinSchema = z.object({
  token: z.string(),
  status: z.enum(["done", "partial", "missed"]),
  note: z.string().optional(),
});

// GET - Validate token and return goal info for the landing page
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const result = await validateAndConsumeToken(token);

    if (!result.valid || !result.tokenRecord) {
      return NextResponse.json(
        { error: result.error || "Invalid token" },
        { status: 400 }
      );
    }

    const { goal } = result.tokenRecord;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get today's tasks
    const todayTasks = goal.tasks.filter((task) => {
      const taskDate = new Date(task.date);
      taskDate.setHours(0, 0, 0, 0);
      return taskDate.getTime() === today.getTime();
    });

    // Check if already checked in today
    const existingCheckin = await prisma.checkin.findUnique({
      where: {
        goalId_date: {
          goalId: goal.id,
          date: today,
        },
      },
    });

    return NextResponse.json({
      valid: true,
      goal: {
        id: goal.id,
        title: goal.title,
        category: goal.category,
      },
      todayTasks: todayTasks.map((task) => ({
        id: task.id,
        title: (task.taskJson as any).title,
        type: (task.taskJson as any).type,
        duration_min: (task.taskJson as any).duration_min,
        status: task.status,
      })),
      existingCheckin: existingCheckin
        ? {
            status: existingCheckin.status,
            note: existingCheckin.note,
          }
        : null,
      purpose: result.tokenRecord.purpose,
    });
  } catch (error) {
    console.error("Token validation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST - Submit check-in via token
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = TokenCheckinSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { token, status, note } = parsed.data;

    const result = await validateAndConsumeToken(token);

    if (!result.valid || !result.tokenRecord) {
      return NextResponse.json(
        { error: result.error || "Invalid token" },
        { status: 400 }
      );
    }

    const { goal } = result.tokenRecord;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Create or update check-in
    const checkin = await prisma.checkin.upsert({
      where: {
        goalId_date: {
          goalId: goal.id,
          date: today,
        },
      },
      update: {
        status,
        note,
        createdVia: "email",
      },
      create: {
        goalId: goal.id,
        date: today,
        status,
        note,
        createdVia: "email",
      },
    });

    // Update task statuses for today
    await prisma.task.updateMany({
      where: {
        goalId: goal.id,
        date: today,
      },
      data: {
        status: status === "done" ? "done" : status === "partial" ? "partial" : "missed",
        completedAt: status === "done" ? new Date() : null,
      },
    });

    // Mark token as used
    await markTokenUsed(token);

    // Log event
    await prisma.eventLog.create({
      data: {
        goalId: goal.id,
        type: "checkin",
        payloadJson: {
          checkinId: checkin.id,
          status,
          date: today.toISOString(),
          createdVia: "email",
        },
      },
    });

    // Check and award badges
    const newBadges = await checkAndAwardCheckinBadges(goal.userId, goal.id);

    return NextResponse.json({
      success: true,
      checkin: {
        id: checkin.id,
        status: checkin.status,
        date: checkin.date,
      },
      goalTitle: goal.title,
      newBadges: newBadges.length > 0 ? newBadges : undefined,
    });
  } catch (error) {
    console.error("Token check-in error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
