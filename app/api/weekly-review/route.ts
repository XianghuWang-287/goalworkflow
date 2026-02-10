/**
 * Weekly Review API
 * POST /api/weekly-review - Generate and store weekly review
 * GET /api/weekly-review?goalId=xxx - Get latest weekly review for a goal
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateWeeklyReview, WeeklyReviewInput } from "@/lib/agents/weeklyReviewer";
import { z } from "zod";

const GenerateReviewSchema = z.object({
  goalId: z.string(),
});

// POST - Generate a new weekly review
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = GenerateReviewSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { goalId } = parsed.data;

    // Verify goal belongs to user
    const goal = await prisma.goal.findFirst({
      where: {
        id: goalId,
        userId: session.user.id,
      },
      include: {
        checkins: {
          where: {
            date: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
          orderBy: { date: "desc" },
        },
        weeklyReviews: {
          orderBy: { weekIndex: "desc" },
          take: 1,
        },
      },
    });

    if (!goal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    // Calculate week index
    const lastReview = goal.weeklyReviews[0];
    const weekIndex = lastReview ? lastReview.weekIndex + 1 : 0;

    // Calculate metrics from checkins
    const checkins = goal.checkins;
    const doneCount = checkins.filter((c) => c.status === "done").length;
    const partialCount = checkins.filter((c) => c.status === "partial").length;
    const missedCount = checkins.filter((c) => c.status === "missed").length;
    const totalCheckins = checkins.length || 7;
    const completionRate = (doneCount + partialCount * 0.5) / totalCheckins;

    // Calculate streak
    let streak = 0;
    const sortedCheckins = [...checkins].sort((a, b) => b.date.getTime() - a.date.getTime());
    let checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);
    checkDate.setDate(checkDate.getDate() - 1);

    for (const checkin of sortedCheckins) {
      const checkinDate = new Date(checkin.date);
      checkinDate.setHours(0, 0, 0, 0);
      if (checkinDate.getTime() === checkDate.getTime()) {
        if (checkin.status === "done" || checkin.status === "partial") {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    }

    // Prepare input for WeeklyReviewer
    const reviewInput: WeeklyReviewInput = {
      weekIndex,
      metrics: {
        completion_rate: completionRate,
        total_checkins: totalCheckins,
        done_count: doneCount,
        partial_count: partialCount,
        missed_count: missedCount,
        streak_days: streak,
      },
      checkins: checkins.map((c) => ({
        date: c.date.toISOString().split("T")[0],
        status: c.status as "done" | "partial" | "missed",
        note: c.note || undefined,
      })),
    };

    // Generate weekly review using AI
    const reviewData = await generateWeeklyReview(reviewInput);

    // Store in database
    const weeklyReview = await prisma.weeklyReview.create({
      data: {
        goalId,
        weekIndex,
        reviewJson: reviewData as any,
      },
    });

    // Log event
    await prisma.eventLog.create({
      data: {
        goalId,
        type: "weekly_review_generated",
        payloadJson: {
          weekIndex,
          completionRate,
          reviewId: weeklyReview.id,
        },
      },
    });

    return NextResponse.json({
      success: true,
      weeklyReview: {
        id: weeklyReview.id,
        weekIndex,
        review: reviewData,
      },
    });
  } catch (error) {
    console.error("Generate weekly review error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET - Get latest weekly review for a goal
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

    const weeklyReview = await prisma.weeklyReview.findFirst({
      where: { goalId },
      orderBy: { weekIndex: "desc" },
    });

    if (!weeklyReview) {
      return NextResponse.json({ error: "No weekly review found" }, { status: 404 });
    }

    return NextResponse.json({
      weeklyReview: {
        id: weeklyReview.id,
        weekIndex: weeklyReview.weekIndex,
        chosenOption: weeklyReview.chosenOption,
        review: weeklyReview.reviewJson,
        createdAt: weeklyReview.createdAt,
      },
    });
  } catch (error) {
    console.error("Get weekly review error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
