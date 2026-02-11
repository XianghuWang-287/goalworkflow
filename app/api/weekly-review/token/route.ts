/**
 * Token-based Weekly Review API
 * GET /api/weekly-review/token?token=xxx - Validate token and get review data
 * POST /api/weekly-review/token - Choose option via token
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAndConsumeToken, markTokenUsed } from "@/lib/tokens";
import { generateWeeklyReview, WeeklyReviewInput, extractPhaseInfo } from "@/lib/agents/weeklyReviewer";
import { generatePlan } from "@/lib/agents/planGenerator";
import { getOrCreateProfile, getOccupiedTimeSlots } from "@/lib/profile/profileManager";
import { UserProfileData } from "@/lib/schemas/userProfile";
import { checkAndAwardWeeklyReviewBadges } from "@/lib/badges";
import { z } from "zod";

const TokenChooseSchema = z.object({
  token: z.string(),
  optionIndex: z.number().int().min(0).max(2),
});

// GET - Validate token and return weekly review data
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

    if (result.tokenRecord.purpose !== "weekly_review") {
      return NextResponse.json(
        { error: "Invalid token purpose" },
        { status: 400 }
      );
    }

    const { goal } = result.tokenRecord;

    // Get or generate weekly review
    let weeklyReview = await prisma.weeklyReview.findFirst({
      where: {
        goalId: goal.id,
        chosenOption: null, // Only get reviews that haven't been acted on
      },
      orderBy: { weekIndex: "desc" },
    });

    // If no pending review, generate one
    if (!weeklyReview) {
      // Get checkins from last 7 days
      const checkins = await prisma.checkin.findMany({
        where: {
          goalId: goal.id,
          date: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
        orderBy: { date: "desc" },
      });

      // Get active plan for context
      const activePlan = await prisma.plan.findFirst({
        where: { goalId: goal.id, status: "active" },
        orderBy: { version: "desc" },
      });

      // Get all completed reviews for history
      const allReviews = await prisma.weeklyReview.findMany({
        where: { goalId: goal.id, chosenOption: { not: null } },
        orderBy: { weekIndex: "asc" },
      });

      // Get last week index
      const lastReview = await prisma.weeklyReview.findFirst({
        where: { goalId: goal.id },
        orderBy: { weekIndex: "desc" },
      });
      const weekIndex = lastReview ? lastReview.weekIndex + 1 : 0;

      // Calculate metrics
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
        category: goalSpec.category || (goal as any).category,
        planStructure: goalSpec.planStructure || (goal as any).planStructure,
        targetMetrics: goalSpec.targetMetrics,
      } : undefined;

      // Build current plan summary
      const planData = activePlan?.planJson as any;
      let currentPlanSummary: WeeklyReviewInput["currentPlanSummary"];
      let phaseInfo: WeeklyReviewInput["phaseInfo"] = undefined;
      if (planData) {
        currentPlanSummary = {
          weekCount: planData.weeks?.length ?? 0,
          currentWeek: activePlan!.currentWeek ?? 0,
          phases: planData.phases?.map((p: any) => ({
            name: p.name,
            focus: p.focus,
            durationWeeks: p.durationWeeks,
          })),
          currentPhaseIndex: activePlan!.currentPhase ?? 0,
        };
        if (planData.phases && planData.phases.length > 0) {
          phaseInfo = extractPhaseInfo(activePlan!);
        }
      }

      // Build review history
      const reviewHistory = allReviews.map((r) => {
        const rData = r.reviewJson as any;
        const optionLabels = ["稳妥", "更快", "更轻松"];
        return {
          weekIndex: r.weekIndex,
          completionRate: rData?.metrics?.completion_rate ?? 0,
          chosenOption: optionLabels[r.chosenOption!] ?? `option ${r.chosenOption}`,
        };
      });

      // Build task details
      let taskDetails: WeeklyReviewInput["taskDetails"];
      if (activePlan) {
        const weekTasks = await prisma.task.findMany({
          where: {
            goalId: goal.id,
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

      const reviewData = await generateWeeklyReview(reviewInput);

      weeklyReview = await prisma.weeklyReview.create({
        data: {
          goalId: goal.id,
          weekIndex,
          reviewJson: reviewData as any,
        },
      });

      await prisma.eventLog.create({
        data: {
          goalId: goal.id,
          type: "weekly_review_generated",
          payloadJson: {
            weekIndex,
            completionRate,
            reviewId: weeklyReview.id,
          },
        },
      });
    }

    const reviewData = weeklyReview.reviewJson as any;

    return NextResponse.json({
      valid: true,
      goal: {
        id: goal.id,
        title: goal.title,
        category: goal.category,
      },
      weeklyReview: {
        id: weeklyReview.id,
        weekIndex: weeklyReview.weekIndex,
        metrics: reviewData.metrics,
        blockers: reviewData.blockers,
        wins: reviewData.wins,
        options: reviewData.next_week_options,
      },
    });
  } catch (error) {
    console.error("Token validation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST - Choose option via token
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = TokenChooseSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { token, optionIndex } = parsed.data;

    const result = await validateAndConsumeToken(token);

    if (!result.valid || !result.tokenRecord) {
      return NextResponse.json(
        { error: result.error || "Invalid token" },
        { status: 400 }
      );
    }

    const { goal } = result.tokenRecord;

    // Get the latest pending weekly review
    const weeklyReview = await prisma.weeklyReview.findFirst({
      where: {
        goalId: goal.id,
        chosenOption: null,
      },
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

    // Get current plan
    const currentPlan = await prisma.plan.findFirst({
      where: {
        goalId: goal.id,
        status: "active",
      },
      orderBy: { version: "desc" },
    });

    // Mark current plan as superseded
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

    // Generate new plan with new signature
    const profile = await getOrCreateProfile(goal.userId);
    const occupiedSlots = await getOccupiedTimeSlots(goal.userId, goal.id);
    const userProfileData: UserProfileData = {
      wakeUpTime: profile.wakeUpTime ?? undefined,
      sleepTime: profile.sleepTime ?? undefined,
      workDays: (profile.workDays as number[]) ?? undefined,
      availableSlots: (profile.availableSlots as any[]) ?? undefined,
      timezone: profile.timezone ?? undefined,
    };

    // Build previous context for plan continuity
    const currentPlanData = currentPlan?.planJson as any;
    let previousContext: Parameters<typeof generatePlan>[0]["previousContext"];
    if (currentPlan) {
      const planWeeks = currentPlanData?.weeks?.length ?? 0;
      const planPhases = currentPlanData?.phases?.map((p: any) => `${p.name} (${p.durationWeeks}w)`).join(" → ") || "none";
      const previousPlanSummary = `${planWeeks}-week plan, phases: ${planPhases}, structure: ${(goal as any).planStructure || "fixed_cycle"}`;

      const allReviews = await prisma.weeklyReview.findMany({
        where: { goalId: goal.id, chosenOption: { not: null } },
        orderBy: { weekIndex: "asc" },
      });
      const optionLabels = ["稳妥", "更快", "更轻松"];
      const historyLines = allReviews.map((r) => {
        const rd = r.reviewJson as any;
        return `Week ${r.weekIndex}: ${Math.round((rd?.metrics?.completion_rate ?? 0) * 100)}% → ${optionLabels[r.chosenOption!] ?? "unknown"}`;
      });
      const completionHistory = historyLines.length > 0
        ? historyLines.join("\n")
        : "First week — no prior history";

      const chosenDirection = `User chose "${chosenOption.label}": ${chosenOption.description}`;
      previousContext = { previousPlanSummary, completionHistory, chosenDirection };
    }

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
      previousContext,
    });
    const newVersion = currentPlan ? currentPlan.version + 1 : 1;

    const newPlan = await prisma.plan.create({
      data: {
        goalId: goal.id,
        startDate: new Date(),
        planJson: newPlanData as any,
        version: newVersion,
        status: "active",
        promptVersion: "v2.0.0",
      },
    });

    // Create tasks
    const taskStartDate = new Date();
    taskStartDate.setHours(0, 0, 0, 0);

    const taskData = newPlanData.weeks.flatMap((week) =>
      week.days.flatMap((day: any, dayIndex: number) =>
      (day.tasks as any[]).map((task: any) => {
        const taskDate = new Date(taskStartDate);
        taskDate.setDate(taskDate.getDate() + dayIndex);
        return {
          goalId: goal.id,
          planId: newPlan.id,
          date: taskDate,
          dayIndex,
          taskJson: task as any,
          status: "pending",
        };
      })
    ));

    await prisma.task.createMany({
      data: taskData,
    });

    // Update weekly review
    await prisma.weeklyReview.update({
      where: { id: weeklyReview.id },
      data: { chosenOption: optionIndex },
    });

    // Mark token as used
    await markTokenUsed(token);

    // Log event
    await prisma.eventLog.create({
      data: {
        goalId: goal.id,
        type: "plan_updated",
        payloadJson: {
          previousPlanId: currentPlan?.id,
          newPlanId: newPlan.id,
          chosenOption: chosenOption.label,
          weekIndex: weeklyReview.weekIndex,
          viaToken: true,
        },
      },
    });

    // Check and award badges
    const newBadges = await checkAndAwardWeeklyReviewBadges(goal.userId, goal.id);

    return NextResponse.json({
      success: true,
      chosenOption: chosenOption.label,
      newPlanVersion: newVersion,
      goalTitle: goal.title,
      newBadges: newBadges.length > 0 ? newBadges : undefined,
    });
  } catch (error) {
    console.error("Token choose option error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
