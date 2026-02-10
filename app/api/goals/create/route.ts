import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  createGoalFastPath,
  finalizePlan,
} from "@/lib/orchestrator/goalCreationFlow";
import { Classification } from "@/lib/schemas/classification";
import { GoalSpec } from "@/lib/schemas/goalSpec";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { title, category, path, goalSpec, classification, conversationId } =
      body;

    if (!title && !goalSpec) {
      return NextResponse.json(
        { error: "Title or goalSpec is required" },
        { status: 400 },
      );
    }

    // Fast path: simple goal, just title
    if (path === "fast" || (!goalSpec && !classification)) {
      const result = await createGoalFastPath(
        session.user.id,
        title,
        category,
      );
      return NextResponse.json(
        {
          goalId: result.goalId,
          plan: result.plan,
          classification: result.classification,
          goalSpec: result.goalSpec,
          violations: result.violations,
          message: "Goal and plan created successfully",
        },
        { status: 201 },
      );
    }

    // Deep path: has goalSpec from expert conversation
    if (goalSpec && classification) {
      const result = await finalizePlan(
        session.user.id,
        goalSpec as GoalSpec,
        classification as Classification,
        conversationId,
      );
      return NextResponse.json(
        {
          goalId: result.goalId,
          plan: result.plan,
          violations: result.violations,
          message: "Goal and plan created successfully",
        },
        { status: 201 },
      );
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  } catch (error) {
    console.error("Goal creation error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
