import { NextResponse } from "next/server";
import { analyzeGoal } from "@/lib/agents/goalAnalyzer";

export async function POST(request: Request) {
  try {
    const { title, category } = await request.json();

    if (!title) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    const analysis = await analyzeGoal(title, category);

    return NextResponse.json(analysis, { status: 200 });
  } catch (error) {
    console.error("Goal analysis error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
