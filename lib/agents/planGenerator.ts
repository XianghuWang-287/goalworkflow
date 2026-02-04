/**
 * PlanGenerator Agent
 * Generates a 7-day plan from GoalSpec
 */

import { JSONGuard } from "../llm/jsonGuard";
import { PlanSchema, Plan } from "../schemas/plan";
import { GoalSpec } from "../schemas/goalSpec";
import { readFileSync } from "fs";
import { join } from "path";

const PROMPT_VERSION = "v1.0.0";

function loadPrompt(): string {
  try {
    const promptPath = join(process.cwd(), "prompts", "plan_generator.md");
    const content = readFileSync(promptPath, "utf-8");
    console.log(`[PlanGenerator] Loaded prompt from ${promptPath} (${content.length} chars)`);
    return content;
  } catch (error) {
    console.warn(`[PlanGenerator] Failed to load prompt file, using fallback:`, error);
    // Fallback if file not found
    return `You are a learning/workflow planning agent. Generate a detailed 7-day plan.
Return ONLY valid JSON matching the Plan schema with 7 days of tasks.`;
  }
}

function getSystemPrompt(): string {
  return `You are a planning agent. You MUST return ONLY valid JSON, no markdown, no explanations, no code blocks.

CRITICAL: The "tasks" array must contain OBJECTS, not strings. Each task object must have:
- title (string)
- type ("learn" | "practice" | "habit" | "assessment")
- duration_min (number)
- instructions (array of strings)
- done_criteria (array of strings)
- fallback (object with min_version and duration_min)

The root JSON must have: version (number), start_date (string), weeks (array).`;
}

function getFallbackTemplate(startDate: string): Plan {
  const days = [];
  const start = new Date(startDate);
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    
    days.push({
      day_index: i,
      date: date.toISOString().split("T")[0],
      tasks: [
        {
          title: `Day ${i + 1} Learning Task`,
          type: "learn",
          duration_min: 30,
          instructions: ["Read materials", "Take notes"],
          deliverable: "Notes document",
          done_criteria: ["Completed reading", "Notes taken"],
          fallback: {
            min_version: "Quick 10-minute review",
            duration_min: 10,
          },
        },
        {
          title: `Day ${i + 1} Practice Task`,
          type: "practice",
          duration_min: 30,
          instructions: ["Practice the concept", "Apply what you learned"],
          deliverable: "Practice output",
          done_criteria: ["Practice completed", "Output created"],
          fallback: {
            min_version: "Quick 10-minute practice",
            duration_min: 10,
          },
        },
      ],
      ...(i === 6 && {
        assessment: {
          type: "reflection",
          title: "Week 1 Assessment",
          instructions: ["Reflect on your progress", "Write a summary"],
          pass_rule: "Write at least 200 words reflecting on the week",
        },
      }),
    });
  }

  return {
    version: 1,
    start_date: startDate,
    weeks: [
      {
        week_index: 0,
        days,
      },
    ],
  };
}

export async function generatePlan(
  goalSpec: GoalSpec,
  startDate: string
): Promise<Plan> {
  console.log(`[PlanGenerator] Starting plan generation for goal: ${goalSpec.title}`);
  
  const guard = new JSONGuard({
    maxRetries: 2,
    fallbackTemplate: () => {
      console.warn(`[PlanGenerator] Using fallback template for startDate: ${startDate}`);
      return getFallbackTemplate(startDate);
    },
  });

  const prompt = loadPrompt();
  
  // Determine if this is a simple habit goal
  const isSimpleHabit = goalSpec.category === "habit" || 
    goalSpec.title.toLowerCase().includes("sleep") ||
    goalSpec.title.toLowerCase().includes("drink") ||
    goalSpec.title.toLowerCase().includes("meditate") ||
    goalSpec.title.toLowerCase().includes("exercise") ||
    goalSpec.title.toLowerCase().includes("wake") ||
    (goalSpec.title.length < 20 && !goalSpec.title.toLowerCase().includes("learn"));
  
  const complexityNote = isSimpleHabit 
    ? "\n\nIMPORTANT: This is a SIMPLE HABIT goal. Generate a MINIMAL, practical plan:\n- Focus on the core action, not learning about it\n- 1-2 simple tasks per day (5-15 min each)\n- Keep it consistent and actionable\n- Example: 'Sleep before 10 PM' is better than 'Learn about sleep hygiene'\n"
    : "\n\nThis is a LEARNING/SKILL goal. Generate a detailed plan with learn + practice tasks.\n";
  
  const userPrompt = `Generate a 7-day plan for this goal:

Goal Spec:
${JSON.stringify(goalSpec, null, 2)}
${complexityNote}

Start Date: ${startDate}

Return the Plan JSON object with exactly 7 days (day_index 0-6), starting from ${startDate}.
${isSimpleHabit 
  ? "Each day should have 1-2 simple, actionable tasks (focus on the core habit action)." 
  : "Each day must have at least 2 tasks (learn + practice)."}
Day 7 (day_index 6) must include an assessment.`;

  try {
    const result = await guard.callAndValidate<Plan>(
      userPrompt,
      getSystemPrompt(),
      PlanSchema
    );
    console.log(`[PlanGenerator] Successfully generated plan with ${result.weeks[0].days.length} days`);
    return result;
  } catch (error) {
    console.error(`[PlanGenerator] Error generating plan:`, error);
    // Return fallback if all else fails
    console.warn(`[PlanGenerator] Returning fallback template due to error`);
    return getFallbackTemplate(startDate);
  }
}
