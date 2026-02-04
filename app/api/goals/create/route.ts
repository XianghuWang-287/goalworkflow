import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { extractGoalSpec } from "@/lib/agents/goalSpecExtractor";
import { generatePlan } from "@/lib/agents/planGenerator";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { title, category, answers } = await request.json();

    if (!title) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    // Step 1: Extract GoalSpec using AI, merge with answers
    console.log("[Goal Creation] Step 1: Extracting GoalSpec...");
    const goalSpecInput = {
      title,
      category,
      ...answers, // Merge answers from questions into GoalSpec
    };
    const goalSpec = await extractGoalSpec(goalSpecInput);
    console.log("[Goal Creation] GoalSpec extracted:", goalSpec);

    // Step 2: Create Goal in database
    const goal = await prisma.goal.create({
      data: {
        userId: session.user.id,
        title: goalSpec.title,
        category: goalSpec.category || category || "other",
        goalSpecJson: goalSpec as any,
        status: "active",
      },
    });

    // Step 3: Generate Plan using AI
    const startDate = new Date().toISOString().split("T")[0];
    console.log("[Goal Creation] Step 3: Generating plan with startDate:", startDate);
    const plan = await generatePlan(goalSpec, startDate);
    console.log("[Goal Creation] Plan generated with", plan.weeks[0].days.length, "days");

    // Step 4: Create Plan and Tasks in database
    const planRecord = await prisma.plan.create({
      data: {
        goalId: goal.id,
        startDate: new Date(startDate),
        planJson: plan as any,
        version: plan.version,
        status: "active",
        promptVersion: "v1.0.0",
      },
    });

    // Create tasks for each day
    const week = plan.weeks[0];
    for (const day of week.days) {
      for (const task of day.tasks) {
        await prisma.task.create({
          data: {
            goalId: goal.id,
            planId: planRecord.id,
            date: new Date(day.date),
            dayIndex: day.day_index,
            taskJson: task as any,
            status: "pending",
          },
        });
      }
    }

    // Step 5: Log event
    await prisma.eventLog.create({
      data: {
        goalId: goal.id,
        type: "goal_created",
        payloadJson: { goalSpec, planGenerated: true } as any,
      },
    });

    return NextResponse.json(
      { goalId: goal.id, message: "Goal and plan created successfully" },
      { status: 201 }
    );
  } catch (error) {
    console.error("Goal creation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
