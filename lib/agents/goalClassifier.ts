/**
 * GoalClassifier Agent
 * Classifies goals by domain, complexity, plan structure, and conversation needs.
 * Uses a two-stage approach: fast keyword pre-classification + LLM deep classification.
 */

import { Classification, ClassificationSchema } from "../schemas/classification";
import { JSONGuard } from "../llm/jsonGuard";
import { readFileSync } from "fs";
import { join } from "path";

const PROMPT_VERSION = "v1.0.0";

// ---------------------------------------------------------------------------
// Stage 1: Zero-latency keyword-based pre-classification
// ---------------------------------------------------------------------------

export function preClassify(title: string): {
  likelySimple: boolean;
  likelyDomain: string | null;
} {
  const lower = title.toLowerCase();

  // Patterns that strongly indicate a simple, single-action habit
  const simplePatterns = [
    /早睡|sleep earl|早起|wake up|喝水|drink water|冥想|meditat/,
    /读书|read.*book|日记|journal|散步|walk/,
  ];
  const isLikelySimple = simplePatterns.some((p) => p.test(lower));

  // Domain detection via keyword matching
  const domainPatterns: [RegExp, string][] = [
    [/减肥|瘦|lose weight|健身|gym|exercise|muscle|增肌|跑步|run/, "fitness"],
    [/学|learn|study|考|exam|编程|code|python|react/, "learning"],
    [/存钱|理财|save|budget|invest|记账/, "finance"],
    [/求职|面试|interview|简历|resume|job/, "career"],
    [/戒|quit|stop.*ing|不再/, "quit"],
    [/写|画|创作|write|draw|paint|music/, "creative"],
    [/焦虑|压力|stress|冥想|meditat|心理/, "mental"],
  ];
  const domain = domainPatterns.find(([p]) => p.test(lower))?.[1] ?? null;

  return { likelySimple: isLikelySimple, likelyDomain: domain };
}

// ---------------------------------------------------------------------------
// Prompt loading helpers
// ---------------------------------------------------------------------------

function loadPrompt(): string {
  try {
    const promptPath = join(process.cwd(), "prompts", "goal_classifier.md");
    const content = readFileSync(promptPath, "utf-8");
    console.log(
      `[GoalClassifier] Loaded prompt from ${promptPath} (${content.length} chars)`
    );
    return content;
  } catch (error) {
    console.warn(
      `[GoalClassifier] Failed to load prompt file, using fallback:`,
      error
    );
    return `You are a goal classification agent. Classify the goal into domain, complexity, planStructure, needsDeepConversation, and suggestedDurationDays.
Return ONLY valid JSON matching the Classification schema.`;
  }
}

function getSystemPrompt(): string {
  return `You are a goal classification agent. You MUST return ONLY valid JSON, no markdown, no explanations, no code blocks.

CRITICAL: The JSON must have these exact fields and types:
- domain: one of "fitness","habit","learning","finance","career","creative","mental","social","lifestyle","quit","general"
- complexity: one of "simple","medium","complex"
- planStructure: one of "fixed_cycle","phased","countdown"
- needsDeepConversation: boolean (true or false)
- suggestedDurationDays: positive integer
- reasoning: string (brief explanation)

Example correct output:
{
  "domain": "habit",
  "complexity": "simple",
  "planStructure": "fixed_cycle",
  "needsDeepConversation": false,
  "suggestedDurationDays": 21,
  "reasoning": "Simple daily habit with clear action"
}`;
}

function getFallbackClassification(): Classification {
  return {
    domain: "general",
    complexity: "medium",
    planStructure: "fixed_cycle",
    needsDeepConversation: true,
    suggestedDurationDays: 21,
    reasoning: "Fallback classification — could not determine from input",
  };
}

// ---------------------------------------------------------------------------
// Stage 2: Full LLM classification
// ---------------------------------------------------------------------------

export async function classifyGoal(
  title: string,
  category?: string
): Promise<Classification> {
  console.log(`[GoalClassifier] Classifying goal: "${title}"`);

  const guard = new JSONGuard({
    maxRetries: 1,
    schemaName: "Classification",
    fallbackTemplate: () => {
      console.warn(`[GoalClassifier] Using fallback classification template`);
      return getFallbackClassification();
    },
  });

  // Run pre-classification for keyword hints
  const hints = preClassify(title);
  console.log(`[GoalClassifier] Pre-classification hints:`, hints);

  const prompt = loadPrompt();

  // Build user message with goal info and pre-classification hints
  const parts: string[] = [`Classify this goal:\n\nTitle: ${title}`];

  if (category) {
    parts.push(`Category: ${category}`);
  }

  parts.push(`\nPre-classification hints (from keyword matching):`);
  parts.push(`- likelySimple: ${hints.likelySimple}`);
  parts.push(
    `- likelyDomain: ${hints.likelyDomain ?? "unknown (no keyword match)"}`
  );

  parts.push(
    `\nAnalyze the goal and return the Classification JSON object.`
  );

  const userPrompt = parts.join("\n");

  try {
    const result = await guard.callAndValidate<Classification>(
      userPrompt,
      getSystemPrompt(),
      ClassificationSchema
    );
    console.log(`[GoalClassifier] Classification result:`, result);
    return result;
  } catch (error) {
    console.error(`[GoalClassifier] Error classifying goal:`, error);
    const fallback = getFallbackClassification();
    fallback.reasoning = `Error during classification — using fallback`;
    return fallback;
  }
}
