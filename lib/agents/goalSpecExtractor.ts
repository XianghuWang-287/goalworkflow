/**
 * GoalSpecExtractor Agent
 * Extracts structured GoalSpec from user input
 */

import { JSONGuard } from "../llm/jsonGuard";
import { GoalSpecSchema, GoalSpec } from "../schemas/goalSpec";
import { readFileSync } from "fs";
import { join } from "path";

const PROMPT_VERSION = "v1.0.0";

function loadPrompt(): string {
  try {
    const promptPath = join(process.cwd(), "prompts", "goal_spec_extractor.md");
    const content = readFileSync(promptPath, "utf-8");
    console.log(`[GoalSpecExtractor] Loaded prompt from ${promptPath} (${content.length} chars)`);
    return content;
  } catch (error) {
    console.warn(`[GoalSpecExtractor] Failed to load prompt file, using fallback:`, error);
    // Fallback if file not found
    return `You are a goal analysis agent. Extract structured information from user's goal input.
Return ONLY valid JSON matching this schema:
{
  "title": "string",
  "category": "string (optional)",
  "description": "string (optional)",
  "timeframe": "string (optional)",
  "currentLevel": "string (optional)",
  "desiredOutcome": "string (optional)",
  "constraints": ["string array (optional)"]
}`;
  }
}

function getSystemPrompt(): string {
  return `You are a goal analysis agent. You MUST return ONLY valid JSON, no markdown, no explanations, no code blocks.`;
}

function getFallbackTemplate(): GoalSpec {
  return {
    title: "Untitled Goal",
    category: "other",
    description: "",
    timeframe: "7 days",
    currentLevel: "",
    desiredOutcome: "",
    constraints: [],
  };
}

export interface GoalSpecExtractorInput {
  title: string;
  category?: string;
  description?: string;
  timeframe?: string;
  currentLevel?: string;
  desiredOutcome?: string;
  constraints?: string[];
  [key: string]: any; // Allow additional fields from questions
}

export async function extractGoalSpec(
  input: GoalSpecExtractorInput
): Promise<GoalSpec> {
  console.log(`[GoalSpecExtractor] Extracting goal spec for title: ${input.title}`);
  
  const guard = new JSONGuard({
    maxRetries: 2,
    fallbackTemplate: () => {
      console.warn(`[GoalSpecExtractor] Using fallback template`);
      return getFallbackTemplate();
    },
  });

  const prompt = loadPrompt();
  
  // Build user prompt with all provided fields
  const fields: string[] = [`Title: ${input.title}`];
  if (input.category) fields.push(`Category: ${input.category}`);
  if (input.description) fields.push(`Description: ${input.description}`);
  if (input.timeframe) fields.push(`Timeframe: ${input.timeframe}`);
  if (input.currentLevel) fields.push(`Current Level: ${input.currentLevel}`);
  if (input.desiredOutcome) fields.push(`Desired Outcome: ${input.desiredOutcome}`);
  
  // Handle constraints - could be array or string
  if (input.constraints) {
    if (Array.isArray(input.constraints) && input.constraints.length > 0) {
      fields.push(`Constraints: ${input.constraints.join(", ")}`);
    } else if (typeof input.constraints === "string" && input.constraints.trim()) {
      fields.push(`Constraints: ${input.constraints}`);
    }
  }
  
  // Include any additional fields from questions
  Object.keys(input).forEach((key) => {
    if (!["title", "category", "description", "timeframe", "currentLevel", "desiredOutcome", "constraints"].includes(key)) {
      fields.push(`${key}: ${input[key]}`);
    }
  });
  
  const userPrompt = `Extract goal specification from this input:
${fields.join("\n")}

Return the GoalSpec JSON object, incorporating all the provided information.`;

  try {
    const result = await guard.callAndValidate<GoalSpec>(
      userPrompt,
      getSystemPrompt(),
      GoalSpecSchema
    );
    console.log(`[GoalSpecExtractor] Successfully extracted goal spec:`, result);
    return result;
  } catch (error) {
    console.error(`[GoalSpecExtractor] Error extracting goal spec:`, error);
    // Return fallback if all else fails
    console.warn(`[GoalSpecExtractor] Returning fallback template due to error`);
    const fallback = getFallbackTemplate();
    fallback.title = input.title; // At least preserve the title
    return fallback;
  }
}
