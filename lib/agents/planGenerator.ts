/**
 * PlanGenerator Agent v2
 * Generates multi-structure plans with constraint validation,
 * domain knowledge injection, and variable duration support.
 */

import { JSONGuard } from "../llm/jsonGuard";
import { PlanSchema, Plan } from "../schemas/plan";
import { GoalSpec } from "../schemas/goalSpec";
import { Classification } from "../schemas/classification";
import { UserProfileData } from "../schemas/userProfile";
import { z } from "zod";
import { getKnowledge, getKnowledgeForPrompt } from "../knowledge/provider";
import {
  validatePlan,
  ConstraintViolation,
  OccupiedSlot,
  StructuredConstraints,
} from "../validators/constraintValidator";
import type { DomainProfile } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

const PROMPT_VERSION = "v2.0.0";
const MAX_VALIDATION_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadPrompt(): string {
  try {
    const promptPath = join(process.cwd(), "prompts", "plan_generator.md");
    const content = readFileSync(promptPath, "utf-8");
    console.log(
      `[PlanGenerator] Loaded prompt ${PROMPT_VERSION} from ${promptPath} (${content.length} chars)`,
    );
    return content;
  } catch (error) {
    console.warn(
      `[PlanGenerator] Failed to load prompt file, using fallback:`,
      error,
    );
    return getFallbackPrompt();
  }
}

function getFallbackPrompt(): string {
  return `You are a planning agent. Generate a structured plan as valid JSON.
The plan must have: version, start_date, totalDurationDays, weeks (array of week objects with days).
Each day has: day_index, date, tasks. Each task has: title, type, duration_min, instructions, done_criteria, fallback.
Return ONLY valid JSON.`;
}

/**
 * Build a human-readable constraint summary string for the LLM prompt.
 */
function buildConstraintSummary(
  goalSpec: GoalSpec,
  occupiedSlots: OccupiedSlot[],
): string {
  const lines: string[] = [];
  const sc = goalSpec.structuredConstraints;

  if (sc?.unavailableDates && sc.unavailableDates.length > 0) {
    lines.push(
      `Unavailable dates (do NOT schedule tasks on these days):\n` +
        sc.unavailableDates.map((d) => `  - ${d}`).join("\n"),
    );
  }

  if (sc?.unavailableSlots && sc.unavailableSlots.length > 0) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    lines.push(
      `Unavailable time slots:\n` +
        sc.unavailableSlots
          .map(
            (s) =>
              `  - ${dayNames[s.dayOfWeek] ?? `Day ${s.dayOfWeek}`}: ${s.start}-${s.end}`,
          )
          .join("\n"),
    );
  }

  if (sc?.maxDailyMinutes != null) {
    lines.push(
      `Maximum daily minutes: ${sc.maxDailyMinutes} min (total task time per day must not exceed this)`,
    );
  }

  if (occupiedSlots.length > 0) {
    // Group occupied slots by goal for readability
    const byGoal = new Map<string, OccupiedSlot[]>();
    for (const slot of occupiedSlots) {
      const key = slot.goalTitle || slot.goalId;
      if (!byGoal.has(key)) byGoal.set(key, []);
      byGoal.get(key)!.push(slot);
    }
    const slotLines: string[] = [];
    for (const [goalName, slots] of Array.from(byGoal.entries())) {
      const slotDescs = slots
        .map((s) => `${s.date} ${s.timeSlot}`)
        .join(", ");
      slotLines.push(`  - "${goalName}" uses: ${slotDescs}`);
    }
    lines.push(
      `Occupied slots from other goals (do NOT overlap):\n` +
        slotLines.join("\n"),
    );
  }

  if (lines.length === 0) {
    return "No specific constraints. Schedule freely.";
  }

  return lines.join("\n\n");
}

/**
 * Build a user profile summary string for the LLM prompt.
 */
function buildUserProfileSummary(userProfile: UserProfileData): string {
  const lines: string[] = [];

  if (userProfile.wakeUpTime) {
    lines.push(`Wake-up time: ${userProfile.wakeUpTime}`);
  }
  if (userProfile.sleepTime) {
    lines.push(`Sleep time: ${userProfile.sleepTime}`);
  }
  if (userProfile.timezone) {
    lines.push(`Timezone: ${userProfile.timezone}`);
  }
  if (userProfile.workDays && userProfile.workDays.length > 0) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    lines.push(
      `Work days: ${userProfile.workDays.map((d) => dayNames[d] ?? d).join(", ")}`,
    );
  }
  if (userProfile.availableSlots && userProfile.availableSlots.length > 0) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    lines.push(
      `Available time slots:\n` +
        userProfile.availableSlots
          .map(
            (s) =>
              `  - ${dayNames[s.dayOfWeek] ?? `Day ${s.dayOfWeek}`}: ${s.start}-${s.end}`,
          )
          .join("\n"),
    );
  }

  if (lines.length === 0) {
    return "No specific profile information provided.";
  }

  return lines.join("\n");
}

/**
 * Calculate the start date (today) and generate a date list for the plan.
 */
function calculateDates(durationDays: number): {
  startDate: string;
  dates: string[];
} {
  const start = new Date();
  const startDate = start.toISOString().split("T")[0];
  const dates: string[] = [];

  for (let i = 0; i < durationDays; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }

  return { startDate, dates };
}

/**
 * Build the filled prompt by replacing all template placeholders.
 */
function buildPrompt(input: {
  template: string;
  goalSpec: GoalSpec;
  classification: Classification;
  userProfile: UserProfileData;
  domainProfile?: DomainProfile | null;
  occupiedSlots: OccupiedSlot[];
  durationDays: number;
  startDate: string;
  dates: string[];
  domainKnowledge: string;
}): string {
  const {
    template,
    goalSpec,
    classification,
    userProfile,
    occupiedSlots,
    durationDays,
    domainKnowledge,
  } = input;

  const constraintSummary = buildConstraintSummary(goalSpec, occupiedSlots);
  const profileSummary = buildUserProfileSummary(userProfile);

  const expertAdvice =
    goalSpec.expertAdvice && goalSpec.expertAdvice.length > 0
      ? goalSpec.expertAdvice.map((a, i) => `${i + 1}. ${a}`).join("\n")
      : "No specific expert advice provided.";

  let filled = template
    .replace(/\{\{PLAN_STRUCTURE\}\}/g, classification.planStructure)
    .replace(/\{\{DURATION_DAYS\}\}/g, String(durationDays))
    .replace(/\{\{GOAL_SPEC\}\}/g, JSON.stringify(goalSpec, null, 2))
    .replace(/\{\{DOMAIN_KNOWLEDGE\}\}/g, domainKnowledge)
    .replace(/\{\{CONSTRAINTS\}\}/g, constraintSummary)
    .replace(/\{\{USER_PROFILE\}\}/g, profileSummary)
    .replace(/\{\{EXPERT_ADVICE\}\}/g, expertAdvice);

  return filled;
}

/**
 * Build the system prompt for the LLM.
 */
function getSystemPrompt(planStructure: string, durationDays: number): string {
  return `You are a planning agent. You MUST return ONLY valid JSON, no markdown, no explanations, no code blocks.

CRITICAL REQUIREMENTS:

1. Each DAY object MUST have ALL these fields:
   - day_index (number, 0-based, global across the plan)
   - date (string "YYYY-MM-DD") - REQUIRED! Calculate from start_date + day_index
   - tasks (array of task objects, at least 1)

2. Each TASK object MUST have:
   - title (string)
   - type ("learn" | "practice" | "habit" | "assessment")
   - duration_min (number)
   - instructions (array of strings, at least 2)
   - done_criteria (array of strings, at least 2)
   - fallback (object with min_version string and duration_min number)
   - specificValues (optional object with numeric values)
   - timeSlot (optional string "HH:MM-HH:MM")

3. The ROOT JSON must have:
   - version (number, always 1)
   - start_date (string "YYYY-MM-DD")
   - totalDurationDays (number, must be ${durationDays})
   - weeks (array of week objects)
   ${planStructure === "phased" ? "- phases (array of phase objects with phaseIndex, name, durationWeeks, focus)" : ""}

4. Plan structure: ${planStructure}
   - Total duration: ${durationDays} days
   - Organize into weekly blocks (last week may have fewer than 7 days)

IMPORTANT: Do NOT omit the "date" field on any day! Do NOT return tasks as strings.`;
}

/**
 * Generate a fallback plan template for any duration.
 * Used when the LLM fails to produce valid output after all retries.
 */
function getFallbackTemplate(
  startDate: string,
  durationDays: number,
  planStructure: string,
  goalTitle: string,
): Plan {
  const start = new Date(startDate);
  const totalWeeks = Math.ceil(durationDays / 7);
  const weeks = [];

  for (let w = 0; w < totalWeeks; w++) {
    const daysInWeek = Math.min(7, durationDays - w * 7);
    const days = [];

    for (let d = 0; d < daysInWeek; d++) {
      const globalDayIndex = w * 7 + d;
      const date = new Date(start);
      date.setDate(start.getDate() + globalDayIndex);

      days.push({
        day_index: globalDayIndex,
        date: date.toISOString().split("T")[0],
        tasks: [
          {
            title: `${goalTitle} - Day ${globalDayIndex + 1}`,
            type: "habit" as const,
            duration_min: 30,
            instructions: [
              "Review your goal and today's focus",
              "Complete the planned activity",
              "Log your progress",
            ],
            done_criteria: [
              "Activity completed",
              "Progress logged",
            ],
            fallback: {
              min_version: "Quick 10-minute version",
              duration_min: 10,
            },
          },
        ],
      });
    }

    weeks.push({ week_index: w, days });
  }

  const plan: Plan = {
    version: 1,
    start_date: startDate,
    totalDurationDays: durationDays,
    weeks,
  };

  // Add phases for phased plans
  if (planStructure === "phased") {
    const phaseCount = Math.min(4, Math.ceil(totalWeeks / 3));
    const weeksPerPhase = Math.ceil(totalWeeks / phaseCount);
    const phaseNames = ["Foundation", "Build", "Intensity", "Mastery"];
    plan.phases = Array.from({ length: phaseCount }, (_, i) => ({
      phaseIndex: i,
      name: phaseNames[i] ?? `Phase ${i + 1}`,
      durationWeeks: Math.min(
        weeksPerPhase,
        totalWeeks - i * weeksPerPhase,
      ),
      focus: `${phaseNames[i] ?? "Phase " + (i + 1)} phase focus`,
    }));
  }

  return plan;
}

/**
 * Format constraint violations into a feedback string for the LLM retry.
 */
function formatViolationFeedback(violations: ConstraintViolation[]): string {
  const lines = violations.map(
    (v, i) =>
      `${i + 1}. [${v.type}] Day ${v.dayIndex}${v.taskIndex >= 0 ? `, Task #${v.taskIndex}` : ""}: ${v.message}`,
  );
  return (
    `\n\nCONSTRAINT VIOLATIONS FOUND — Please fix these issues:\n` +
    lines.join("\n") +
    `\n\nRegenerate the plan with these violations resolved. Return ONLY the corrected JSON.`
  );
}

// ---------------------------------------------------------------------------
// Main exports
// ---------------------------------------------------------------------------

export async function generatePlan(input: {
  goalSpec: GoalSpec;
  classification: Classification;
  userProfile: UserProfileData;
  domainProfile?: DomainProfile | null;
  occupiedSlots: OccupiedSlot[];
}): Promise<{ plan: Plan; violations: ConstraintViolation[] }> {
  const { goalSpec, classification, userProfile, occupiedSlots } = input;

  console.log(
    `[PlanGenerator] Starting plan generation for goal: "${goalSpec.title}" ` +
      `(structure=${classification.planStructure}, domain=${classification.domain})`,
  );

  // 1. Determine duration
  const durationDays =
    goalSpec.durationDays ??
    classification.suggestedDurationDays ??
    (classification.planStructure === "fixed_cycle" ? 28 : 56);

  console.log(`[PlanGenerator] Duration: ${durationDays} days`);

  // 2. Calculate dates
  const { startDate, dates } = calculateDates(durationDays);

  // 3. Load domain knowledge
  let domainKnowledge = "No domain-specific knowledge available.";
  try {
    domainKnowledge = getKnowledgeForPrompt(classification.domain);
    console.log(
      `[PlanGenerator] Loaded domain knowledge for "${classification.domain}" (${domainKnowledge.length} chars)`,
    );
  } catch (error) {
    console.warn(
      `[PlanGenerator] Failed to load domain knowledge for "${classification.domain}":`,
      error,
    );
  }

  // 4. Load safety rules for validation
  let safetyRules: import("../knowledge/types").SafetyRule[] = [];
  try {
    const knowledge = getKnowledge(classification.domain);
    safetyRules = knowledge.safetyRules ?? [];
  } catch {
    // No safety rules available — continue without them
  }

  // 5. Build the prompt
  const template = loadPrompt();
  const userPrompt = buildPrompt({
    template,
    goalSpec,
    classification,
    userProfile,
    domainProfile: input.domainProfile,
    occupiedSlots,
    durationDays,
    startDate,
    dates,
    domainKnowledge,
  });

  const systemPrompt = getSystemPrompt(
    classification.planStructure,
    durationDays,
  );

  // 6. Create JSONGuard with fallback
  const guard = new JSONGuard({
    maxRetries: 2,
    schemaName: "Plan",
    fallbackTemplate: () => {
      console.warn(
        `[PlanGenerator] Using fallback template (${durationDays} days, ${classification.planStructure})`,
      );
      return getFallbackTemplate(
        startDate,
        durationDays,
        classification.planStructure,
        goalSpec.title,
      );
    },
  });

  // 7. Generate -> Validate -> Retry loop
  const constraints: StructuredConstraints =
    goalSpec.structuredConstraints ?? {};

  let currentPrompt = userPrompt;
  let plan: Plan | null = null;
  let violations: ConstraintViolation[] = [];

  for (let attempt = 0; attempt < MAX_VALIDATION_ATTEMPTS; attempt++) {
    console.log(
      `[PlanGenerator] Validation attempt ${attempt + 1}/${MAX_VALIDATION_ATTEMPTS}`,
    );

    try {
      plan = await guard.callAndValidate<Plan>(
        currentPrompt,
        systemPrompt,
        PlanSchema as z.ZodType<Plan>,
      );
    } catch (error) {
      console.error(`[PlanGenerator] LLM generation failed on attempt ${attempt + 1}:`, error);
      // Use fallback on final attempt
      if (attempt === MAX_VALIDATION_ATTEMPTS - 1) {
        console.warn(`[PlanGenerator] All attempts failed, using fallback template`);
        plan = getFallbackTemplate(
          startDate,
          durationDays,
          classification.planStructure,
          goalSpec.title,
        );
      }
      continue;
    }

    // Validate the generated plan against constraints
    const result = validatePlan(
      plan,
      constraints,
      userProfile,
      occupiedSlots,
      safetyRules,
    );

    violations = result.violations;

    if (result.valid) {
      console.log(
        `[PlanGenerator] Plan passed validation on attempt ${attempt + 1}`,
      );
      break;
    }

    console.warn(
      `[PlanGenerator] Plan has ${violations.length} violation(s) on attempt ${attempt + 1}`,
    );

    // If not the last attempt, append violation feedback and retry
    if (attempt < MAX_VALIDATION_ATTEMPTS - 1) {
      currentPrompt = userPrompt + formatViolationFeedback(violations);
    } else {
      console.warn(
        `[PlanGenerator] Returning plan with ${violations.length} unresolved violation(s)`,
      );
    }
  }

  if (!plan) {
    // Should not happen, but safety net
    console.error(`[PlanGenerator] No plan generated, using fallback`);
    plan = getFallbackTemplate(
      startDate,
      durationDays,
      classification.planStructure,
      goalSpec.title,
    );
  }

  console.log(
    `[PlanGenerator] Plan generation complete: ${plan.weeks.length} week(s), ` +
      `${plan.weeks.reduce((sum, w) => sum + w.days.length, 0)} day(s), ` +
      `${violations.length} violation(s)`,
  );

  return { plan, violations };
}

/**
 * Fast-path plan generation from just a title.
 * Creates minimal GoalSpec and Classification, then delegates to generatePlan.
 */
export async function generateSimplePlan(input: {
  title: string;
  userProfile: UserProfileData;
  occupiedSlots: OccupiedSlot[];
}): Promise<{
  plan: Plan;
  classification: Classification;
  goalSpec: GoalSpec;
}> {
  console.log(
    `[PlanGenerator] generateSimplePlan for: "${input.title}"`,
  );

  // Create a minimal GoalSpec
  const goalSpec: GoalSpec = {
    title: input.title,
    category: "general",
    description: input.title,
    complexity: "simple",
    planStructure: "fixed_cycle",
    durationDays: 7,
  };

  // Create a default Classification
  const classification: Classification = {
    domain: "general",
    complexity: "simple",
    planStructure: "fixed_cycle",
    needsDeepConversation: false,
    suggestedDurationDays: 7,
    reasoning: "Simple plan generated via fast path",
  };

  const { plan } = await generatePlan({
    goalSpec,
    classification,
    userProfile: input.userProfile,
    occupiedSlots: input.occupiedSlots,
  });

  return { plan, classification, goalSpec };
}
