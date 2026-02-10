import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { classifyGoal, preClassify } from "@/lib/agents/goalClassifier";
import { startDeepPath } from "@/lib/orchestrator/goalCreationFlow";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { title, category } = await request.json();
    if (!title) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 },
      );
    }

    // Step 1: Classify the goal
    const classification = await classifyGoal(title, category);

    // Step 2: If deep conversation needed, start it
    let conversation = null;
    if (classification.needsDeepConversation) {
      conversation = await startDeepPath(
        session.user.id,
        title,
        classification,
      );
    }

    return NextResponse.json({
      classification,
      conversation: conversation
        ? {
            conversationId: conversation.conversationId,
            firstTurn: conversation.firstTurn,
          }
        : null,
    });
  } catch (error) {
    console.error("Goal analysis error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
