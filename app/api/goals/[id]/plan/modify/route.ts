import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { modifyPlanByChat } from "@/lib/agents/planModifier";
import { Plan } from "@/lib/schemas/plan";
import { GoalSpec } from "@/lib/schemas/goalSpec";
import { getOccupiedTimeSlots, getOrCreateProfile } from "@/lib/profile/profileManager";
import { UserProfileData } from "@/lib/schemas/userProfile";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { request: modificationRequest } = await request.json();
    if (!modificationRequest) {
      return NextResponse.json(
        { error: "Modification request is required" },
        { status: 400 }
      );
    }

    // Get the goal and active plan
    const goal = await prisma.goal.findFirst({
      where: { id: params.id, userId: session.user.id },
      include: {
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

    const activePlan = goal.plans[0];
    if (!activePlan) {
      return NextResponse.json(
        { error: "No active plan found" },
        { status: 404 }
      );
    }

    const currentPlan = activePlan.planJson as any as Plan;
    const goalSpec = goal.goalSpecJson as any as GoalSpec;

    // Get user profile and occupied slots
    const profile = await getOrCreateProfile(session.user.id);
    const occupiedSlots = await getOccupiedTimeSlots(session.user.id, goal.id);
    const userProfile: UserProfileData = {
      wakeUpTime: profile.wakeUpTime ?? undefined,
      sleepTime: profile.sleepTime ?? undefined,
      workDays: (profile.workDays as number[]) ?? undefined,
      availableSlots: (profile.availableSlots as any[]) ?? undefined,
      timezone: profile.timezone ?? undefined,
    };

    const result = await modifyPlanByChat({
      planId: activePlan.id,
      currentPlan,
      request: modificationRequest,
      goalSpec,
      occupiedSlots,
      userProfile,
    });

    return NextResponse.json({
      plan: result.plan,
      changeSummary: result.changeSummary,
      violations: result.violations,
      versionId: result.versionId,
    });
  } catch (error) {
    console.error("Plan modification error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
