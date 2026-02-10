/**
 * Choose Weekly Review Option API
 * POST /api/weekly-review/choose - Select an option and apply plan patch
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generatePlan } from "@/lib/agents/planGenerator";
import { getOrCreateProfile, getOccupiedTimeSlots } from "@/lib/profile/profileManager";
import { UserProfileData } from "@/lib/schemas/userProfile";
import { z } from "zod";

const ChooseOptionSchema = z.object({
  reviewId: z.string(),
  optionIndex: z.number().int().min(0).max(2),
});

export async function POST(req: NextRequest) {
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

    const { reviewId, optionIndex } = parsed.data;

    // Get the weekly review
    const weeklyReview = await prisma.weeklyReview.findUnique({
      where: { id: reviewId },
      include: {
        goal: {
          include: {
            plans: {
              where: { status: "active" },
              orderBy: { version: "desc" },
              take: 1,
            },
          },
        },
      },
    });

    if (!weeklyReview) {
      return NextResponse.json({ error: "Weekly review not found" }, { status: 404 });
    }

    // Verify goal belongs to user
    if (weeklyReview.goal.userId !== session.user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Check if already chosen
    if (weeklyReview.chosenOption !== null) {
      return NextResponse.json(
        { error: "Option already chosen for this review" },
        { status: 400 }
      );
    }

    const reviewData = weeklyReview.reviewJson as any;
    const chosenOption = reviewData.next_week_options[optionIndex];

    if (!chosenOption) {
      return NextResponse.json({ error: "Invalid option index" }, { status: 400 });
    }

    // Mark current plan as superseded
    const currentPlan = weeklyReview.goal.plans[0];
    if (currentPlan) {
      await prisma.plan.update({
        where: { id: currentPlan.id },
        data: { status: "superseded" },
      });
    }

    // Generate new plan based on GoalSpec and the chosen option's direction
    const goalSpec = weeklyReview.goal.goalSpecJson as any;

    // Adjust GoalSpec based on chosen option
    let adjustedGoalSpec = { ...goalSpec };
    if (chosenOption.label === "更快") {
      // Increase intensity
      adjustedGoalSpec.intensity = "high";
      adjustedGoalSpec.daily_commitment_minutes = Math.min(
        (goalSpec.daily_commitment_minutes || 30) * 1.5,
        120
      );
    } else if (chosenOption.label === "更轻松") {
      // Decrease intensity
      adjustedGoalSpec.intensity = "low";
      adjustedGoalSpec.daily_commitment_minutes = Math.max(
        (goalSpec.daily_commitment_minutes || 30) * 0.7,
        15
      );
    }
    // "稳妥" keeps the same intensity

    // Generate new plan with new signature
    const profile = await getOrCreateProfile(session.user.id);
    const occupiedSlots = await getOccupiedTimeSlots(session.user.id, weeklyReview.goal.id);
    const userProfile: UserProfileData = {
      wakeUpTime: profile.wakeUpTime ?? undefined,
      sleepTime: profile.sleepTime ?? undefined,
      workDays: (profile.workDays as number[]) ?? undefined,
      availableSlots: (profile.availableSlots as any[]) ?? undefined,
      timezone: profile.timezone ?? undefined,
    };
    const { plan: newPlanData } = await generatePlan({
      goalSpec: adjustedGoalSpec,
      classification: {
        domain: (weeklyReview.goal as any).domain || "general",
        complexity: ((weeklyReview.goal as any).complexity as any) || "simple",
        planStructure: ((weeklyReview.goal as any).planStructure as any) || "fixed_cycle",
        needsDeepConversation: false,
      },
      userProfile,
      occupiedSlots,
    });

    // Calculate new version
    const newVersion = currentPlan ? currentPlan.version + 1 : 1;

    // Create new plan
    const newPlan = await prisma.plan.create({
      data: {
        goalId: weeklyReview.goal.id,
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
          goalId: weeklyReview.goal.id,
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

    // Update weekly review with chosen option
    await prisma.weeklyReview.update({
      where: { id: reviewId },
      data: { chosenOption: optionIndex },
    });

    // Log event
    await prisma.eventLog.create({
      data: {
        goalId: weeklyReview.goal.id,
        type: "plan_updated",
        payloadJson: {
          previousPlanId: currentPlan?.id,
          newPlanId: newPlan.id,
          chosenOption: chosenOption.label,
          weekIndex: weeklyReview.weekIndex,
        },
      },
    });

    return NextResponse.json({
      success: true,
      newPlan: {
        id: newPlan.id,
        version: newPlan.version,
        startDate: newPlan.startDate,
      },
      chosenOption: chosenOption.label,
    });
  } catch (error) {
    console.error("Choose weekly review option error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
