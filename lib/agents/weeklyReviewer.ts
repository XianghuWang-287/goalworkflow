/**
 * WeeklyReviewer Agent
 * Analyzes past week and generates 3 next-week options
 */

import { JSONGuard } from "../llm/jsonGuard";
import { WeeklyReviewSchema, WeeklyReview } from "../schemas/weeklyReview";
import { readFileSync } from "fs";
import { join } from "path";

const PROMPT_VERSION = "v1.0.0";

function loadPrompt(): string {
  try {
    const promptPath = join(process.cwd(), "prompts", "weekly_reviewer.md");
    return readFileSync(promptPath, "utf-8");
  } catch (error) {
    // Fallback if file not found
    return `You are a weekly review agent. Analyze progress and generate 3 options for next week.
Return ONLY valid JSON matching the WeeklyReview schema.`;
  }
}

function getSystemPrompt(): string {
  return `You are a review agent. You MUST return ONLY valid JSON, no markdown, no explanations, no code blocks.`;
}

function getFallbackTemplate(weekIndex: number): WeeklyReview {
  return {
    week_index: weekIndex,
    metrics: {
      completion_rate: 0.5,
      total_checkins: 7,
      done_count: 3,
      partial_count: 2,
      missed_count: 2,
      streak_days: 0,
    },
    blockers: ["Time constraints", "Difficulty"],
    wins: ["Started the goal", "Made some progress"],
    next_week_options: [
      {
        label: "稳妥",
        description: "Maintain current pace, focus on consistency",
        plan_patch: {},
      },
      {
        label: "更快",
        description: "Increase intensity and add more content",
        plan_patch: {},
      },
      {
        label: "更轻松",
        description: "Reduce daily commitment, focus on sustainability",
        plan_patch: {},
      },
    ],
  };
}

export interface WeeklyReviewInput {
  weekIndex: number;
  metrics: {
    completion_rate: number;
    total_checkins: number;
    done_count: number;
    partial_count: number;
    missed_count: number;
    streak_days: number;
  };
  checkins: Array<{
    date: string;
    status: "done" | "partial" | "missed";
    note?: string;
  }>;
  blockers?: string[];
  wins?: string[];
}

export async function generateWeeklyReview(
  input: WeeklyReviewInput
): Promise<WeeklyReview> {
  const guard = new JSONGuard({
    maxRetries: 2,
    fallbackTemplate: () => getFallbackTemplate(input.weekIndex),
  });

  const prompt = loadPrompt();
  const userPrompt = `Generate a weekly review for week ${input.weekIndex}:

Metrics:
${JSON.stringify(input.metrics, null, 2)}

Check-ins:
${JSON.stringify(input.checkins, null, 2)}

${input.blockers && input.blockers.length > 0 ? `Blockers: ${input.blockers.join(", ")}` : ""}
${input.wins && input.wins.length > 0 ? `Wins: ${input.wins.join(", ")}` : ""}

Return the WeeklyReview JSON object with 3 next_week_options (稳妥, 更快, 更轻松).`;

  const result = await guard.callAndValidate<WeeklyReview>(
    userPrompt,
    getSystemPrompt(),
    WeeklyReviewSchema
  );

  return result;
}
