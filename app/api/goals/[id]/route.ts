/**
 * Goal API
 * GET /api/goals/[id] - Get goal details
 * DELETE /api/goals/[id] - Delete a goal
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const goal = await prisma.goal.findFirst({
      where: {
        id: params.id,
        userId: session.user.id,
      },
      include: {
        plans: {
          where: { status: "active" },
          orderBy: { version: "desc" },
          take: 1,
        },
        tasks: {
          orderBy: { date: "asc" },
        },
        checkins: {
          orderBy: { date: "desc" },
          take: 7,
        },
      },
    });

    if (!goal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    return NextResponse.json({ goal });
  } catch (error) {
    console.error("Get goal error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // First verify the goal belongs to the user
    const goal = await prisma.goal.findFirst({
      where: {
        id: params.id,
        userId: session.user.id,
      },
    });

    if (!goal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    // Delete in order due to foreign key constraints
    // 1. Delete OneTimeTokens
    await prisma.oneTimeToken.deleteMany({
      where: { goalId: params.id },
    });

    // 2. Delete Badges
    await prisma.badge.deleteMany({
      where: { goalId: params.id },
    });

    // 3. Delete EventLogs
    await prisma.eventLog.deleteMany({
      where: { goalId: params.id },
    });

    // 4. Delete Checkins
    await prisma.checkin.deleteMany({
      where: { goalId: params.id },
    });

    // 5. Delete WeeklyReviews
    await prisma.weeklyReview.deleteMany({
      where: { goalId: params.id },
    });

    // 6. Delete Tasks
    await prisma.task.deleteMany({
      where: { goalId: params.id },
    });

    // 7. Delete Plans
    await prisma.plan.deleteMany({
      where: { goalId: params.id },
    });

    // 8. Finally delete the Goal
    await prisma.goal.delete({
      where: { id: params.id },
    });

    return NextResponse.json({
      success: true,
      message: "Goal deleted successfully",
    });
  } catch (error) {
    console.error("Delete goal error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
