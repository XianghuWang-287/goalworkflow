/**
 * Weekly Review API
 * POST /api/weekly-review - Generate and store weekly review
 * GET /api/weekly-review?goalId=xxx - Get latest weekly review for a goal
 * PATCH /api/weekly-review - Choose option (authenticated)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateWeeklyReview, WeeklyReviewInput, extractPhaseInfo } from "@/lib/agents/weeklyReviewer";
import { generatePlan } from "@/lib/agents/planGenerator";
import { getOrCreateProfile, getOccupiedTimeSlots } from "@/lib/profile/profileManager";
import { UserProfileData } from "@/lib/schemas/userProfile";
import { checkAndAwardWeeklyReviewBadges } from "@/lib/badges";
import { z } from "zod";

const GenerateReviewSchema = z.object({
  goalId: z.string(),
});

const ChooseOptionSchema = z.object({
  goalId: z.string(),
  optionIndex: z.number().int().min(0).max(2),
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
        },
        plans: {
          where: { status: "active" },
          orderBy: { version: "desc" },
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

    // Build goal context
    const goalSpec = goal.goalSpecJson as any;
    const goalContext = goalSpec ? {
      title: goalSpec.title || goal.title,
      description: goalSpec.description,
      desiredOutcome: goalSpec.desiredOutcome,
      category: goalSpec.category || goal.category,
      planStructure: goalSpec.planStructure || (goal as any).planStructure,
      targetMetrics: goalSpec.targetMetrics,
    } : undefined;

    // Build current plan summary
    const activePlan = goal.plans[0];
    const planData = activePlan?.planJson as any;
    let currentPlanSummary: WeeklyReviewInput["currentPlanSummary"];
    let phaseInfo: WeeklyReviewInput["phaseInfo"] = undefined;
    if (planData) {
      currentPlanSummary = {
        weekCount: planData.weeks?.length ?? 0,
        currentWeek: activePlan.currentWeek ?? 0,
        phases: planData.phases?.map((p: any) => ({
          name: p.name,
          focus: p.focus,
          durationWeeks: p.durationWeeks,
        })),
        currentPhaseIndex: activePlan.currentPhase ?? 0,
      };
      if (planData.phases && planData.phases.length > 0) {
        phaseInfo = extractPhaseInfo(activePlan);
      }
    }

    // Build review history from completed reviews
    const completedReviews = goal.weeklyReviews.filter((r) => r.chosenOption !== null);
    const reviewHistory = completedReviews.map((r) => {
      const rData = r.reviewJson as any;
      const optionLabels = ["稳妥", "更快", "更轻松"];
      return {
        weekIndex: r.weekIndex,
        completionRate: rData?.metrics?.completion_rate ?? 0,
        chosenOption: optionLabels[r.chosenOption!] ?? `option ${r.chosenOption}`,
      };
    });

    // Build task details from this week's tasks
    let taskDetails: WeeklyReviewInput["taskDetails"];
    if (activePlan) {
      const weekTasks = await prisma.task.findMany({
        where: {
          goalId,
          planId: activePlan.id,
          date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      });
      if (weekTasks.length > 0) {
        taskDetails = weekTasks.map((t) => ({
          title: (t.taskJson as any)?.title || "Unknown task",
          status: t.status as "done" | "partial" | "missed",
          specificValues: (t.taskJson as any)?.specificValues,
          timeSlot: (t.taskJson as any)?.timeSlot,
        }));
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
      goalContext,
      currentPlanSummary,
      phaseInfo,
      taskDetails,
      reviewHistory: reviewHistory.length > 0 ? reviewHistory : undefined,
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

// PATCH - Choose option (authenticated)
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = ChooseOptionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { goalId, optionIndex } = parsed.data;

    const goal = await prisma.goal.findFirst({
      where: { id: goalId, userId: session.user.id },
    });
    if (!goal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    // Get latest pending review
    const weeklyReview = await prisma.weeklyReview.findFirst({
      where: { goalId, chosenOption: null },
      orderBy: { weekIndex: "desc" },
    });
    if (!weeklyReview) {
      return NextResponse.json(
        { error: "No pending weekly review found" },
        { status: 404 }
      );
    }

    const reviewData = weeklyReview.reviewJson as any;
    const chosenOption = reviewData.next_week_options[optionIndex];
    if (!chosenOption) {
      return NextResponse.json({ error: "Invalid option index" }, { status: 400 });
    }

    // Get current active plan
    const currentPlan = await prisma.plan.findFirst({
      where: { goalId, status: "active" },
      orderBy: { version: "desc" },
    });

    if (currentPlan) {
      await prisma.plan.update({
        where: { id: currentPlan.id },
        data: { status: "superseded" },
      });
    }

    // Adjust GoalSpec based on chosen option
    const goalSpec = goal.goalSpecJson as any;
    let adjustedGoalSpec = { ...goalSpec };
    if (chosenOption.label === "更快") {
      adjustedGoalSpec.intensity = "high";
      adjustedGoalSpec.daily_commitment_minutes = Math.min(
        (goalSpec.daily_commitment_minutes || 30) * 1.5,
        120
      );
    } else if (chosenOption.label === "更轻松") {
      adjustedGoalSpec.intensity = "low";
      adjustedGoalSpec.daily_commitment_minutes = Math.max(
        (goalSpec.daily_commitment_minutes || 30) * 0.7,
        15
      );
    }

    // Generate new plan
    const profile = await getOrCreateProfile(goal.userId);
    const occupiedSlots = await getOccupiedTimeSlots(goal.userId, goalId);
    const userProfileData: UserProfileData = {
      wakeUpTime: profile.wakeUpTime ?? undefined,
      sleepTime: profile.sleepTime ?? undefined,
      workDays: (profile.workDays as number[]) ?? undefined,
      availableSlots: (profile.availableSlots as any[]) ?? undefined,
      timezone: profile.timezone ?? undefined,
    };
    const { plan: newPlanData } = await generatePlan({
      goalSpec: adjustedGoalSpec,
      classification: {
        domain: (goal as any).domain || "general",
        complexity: ((goal as any).complexity as any) || "simple",
        planStructure: ((goal as any).planStructure as any) || "fixed_cycle",
        needsDeepConversation: false,
      },
      userProfile: userProfileData,
      occupiedSlots,
    });

    const newVersion = currentPlan ? currentPlan.version + 1 : 1;
    const newPlan = await prisma.plan.create({
      data: {
        goalId,
        startDate: new Date(),
        planJson: newPlanData as any,
        version: newVersion,
        status: "active",
        promptVersion: "v2.0.0",
      },
    });

    // Create tasks from new plan
    const taskStartDate = new Date();
    taskStartDate.setHours(0, 0, 0, 0);
    const taskData = newPlanData.weeks.flatMap((week) =>
      week.days.flatMap((day: any, dayIndex: number) =>
        (day.tasks as any[]).map((task: any) => {
          const taskDate = new Date(taskStartDate);
          taskDate.setDate(taskDate.getDate() + dayIndex);
          return {
            goalId,
            planId: newPlan.id,
            date: taskDate,
            dayIndex,
            taskJson: task as any,
            status: "pending",
          };
        })
      )
    );
    await prisma.task.createMany({ data: taskData });

    // Update weekly review
    await prisma.weeklyReview.update({
      where: { id: weeklyReview.id },
      data: { chosenOption: optionIndex },
    });

    // Log event
    await prisma.eventLog.create({
      data: {
        goalId,
        type: "plan_updated",
        payloadJson: {
          previousPlanId: currentPlan?.id,
          newPlanId: newPlan.id,
          chosenOption: chosenOption.label,
          weekIndex: weeklyReview.weekIndex,
          viaAuthenticated: true,
        },
      },
    });

    const newBadges = await checkAndAwardWeeklyReviewBadges(session.user.id, goalId);

    return NextResponse.json({
      success: true,
      chosenOption: chosenOption.label,
      newPlanVersion: newVersion,
      newBadges: newBadges.length > 0 ? newBadges : undefined,
    });
  } catch (error) {
    console.error("PATCH weekly review error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
