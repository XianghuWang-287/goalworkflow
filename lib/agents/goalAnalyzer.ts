/**
 * GoalAnalyzer Agent
 * Analyzes user's goal and generates follow-up questions to gather more information
 */

import { JSONGuard } from "../llm/jsonGuard";
import { z } from "zod";

const QuestionSchema = z.object({
  question: z.string(),
  type: z.enum(["text", "select", "number"]),
  field: z.string(), // Field name in GoalSpec
  suggestions: z.array(z.string()).optional(), // Suggested options
  placeholder: z.string().optional(),
});

const AnalysisSchema = z.object({
  goalType: z.enum(["simple_habit", "learning", "complex"]),
  needsMoreInfo: z.boolean(),
  questions: z.array(QuestionSchema).optional(),
  estimatedQuestions: z.number().optional(),
});

export type Question = z.infer<typeof QuestionSchema>;
export type GoalAnalysis = z.infer<typeof AnalysisSchema>;

function getSystemPrompt(): string {
  return `You are a goal analysis agent. Analyze the user's goal and determine what additional information is needed to create an effective plan.

You MUST return ONLY valid JSON matching this exact schema:
{
  "goalType": "simple_habit" | "learning" | "complex",
  "needsMoreInfo": boolean,
  "questions": [
    {
      "question": "string (the question text)",
      "type": "text" | "select" | "number",
      "field": "string (must match GoalSpec field: description, timeframe, currentLevel, desiredOutcome, or constraints)",
      "suggestions": ["option1", "option2", ...] (optional, for select type),
      "placeholder": "string" (optional, for text/number type)
    }
  ],
  "estimatedQuestions": number (optional)
}

Return ONLY the JSON object, no markdown, no explanations.`;
}

export async function analyzeGoal(
  title: string,
  category?: string
): Promise<GoalAnalysis> {
  const guard = new JSONGuard({
    maxRetries: 2,
    schemaName: "GoalAnalysis",
    fallbackTemplate: () => ({
      goalType: "complex" as const,
      needsMoreInfo: false,
      questions: [],
    }),
  });

  const prompt = `Analyze this goal and determine what questions to ask:

Title: ${title}
${category ? `Category: ${category}` : ""}

Determine:
1. Is this a simple habit (like "sleep earlier", "drink water") or a learning goal (like "learn Python")?
2. What additional information is needed? Generate 3-5 specific questions.

For SIMPLE HABIT goals, ask about:
- Specific target (field: "desiredOutcome" or "description", e.g., "What time do you want to sleep?" → "10 PM")
- Current state (field: "currentLevel", e.g., "What time do you usually sleep now?" → "12 AM")
- Duration/consistency (field: "timeframe", e.g., "How many days per week?" → "7 days per week")

For LEARNING goals, ask about:
- Time commitment (field: "timeframe", e.g., "How many hours per day?" → "2 hours per day")
- Current level (field: "currentLevel", e.g., "Are you a beginner or have some experience?" → "beginner")
- Desired outcome (field: "desiredOutcome", e.g., "What do you want to achieve?" → "Build a web app")
- Timeline (field: "timeframe", e.g., "How long do you have?" → "2 months")

IMPORTANT: Field names must match GoalSpec schema:
- "title" (already provided)
- "category" (already provided)
- "description" (for additional details)
- "timeframe" (for duration/timeline)
- "currentLevel" (for current state/level)
- "desiredOutcome" (for what they want to achieve)
- "constraints" (array, for limitations)

For each question, provide:
- The question text (clear and specific)
- Type: "text", "select", or "number"
- Field name (must match one of the GoalSpec fields above)
- 3-5 suggested options (for select type, make them specific and actionable)
- Placeholder text (for text/number type)

Return the analysis JSON.`;

  try {
    const result = await guard.callAndValidate<GoalAnalysis>(
      prompt,
      getSystemPrompt(),
      AnalysisSchema
    );
    return result;
  } catch (error) {
    console.error("[GoalAnalyzer] Error analyzing goal:", error);
    return {
      goalType: "complex",
      needsMoreInfo: false,
      questions: [],
    };
  }
}
