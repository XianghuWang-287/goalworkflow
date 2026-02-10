import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { continueDeepPath } from "@/lib/orchestrator/goalCreationFlow";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { conversationId, message, stream } = await request.json();

    if (!conversationId || !message) {
      return NextResponse.json(
        { error: "conversationId and message are required" },
        { status: 400 },
      );
    }

    // Non-streaming fallback for backwards compatibility
    if (!stream) {
      const result = await continueDeepPath(conversationId, message);
      return NextResponse.json(result);
    }

    // SSE streaming response
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const send = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          const result = await continueDeepPath(conversationId, message, (token) => {
            send({ type: "token", content: token });
          });

          if (result.done && result.goalSpec) {
            send({
              type: "complete",
              message: result.message,
              goalSpec: result.goalSpec,
              options: result.options,
              profileUpdates: result.profileUpdates,
            });
          } else {
            send({
              type: "done",
              message: result.message,
              options: result.options,
              done: result.done,
            });
          }
        } catch (error) {
          send({
            type: "error",
            message: error instanceof Error ? error.message : "Internal server error",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Conversation error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
