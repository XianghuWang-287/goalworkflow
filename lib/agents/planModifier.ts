/**
 * PlanModifier Agent
 * Handles natural language modifications and direct edits to existing plans,
 * with constraint validation and plan versioning.
 */

import { prisma } from "@/lib/prisma";
import { JSONGuard } from "../llm/jsonGuard";
import { PlanSchema, Plan } from "../schemas/plan";
import { GoalSpec } from "../schemas/goalSpec";
import {
  validatePlan,
  ConstraintViolation,
  OccupiedSlot,
  StructuredConstraints,
} from "../validators/constraintValidator";
import { getKnowledge, getKnowledgeForPrompt } from "../knowledge/provider";
import type { DomainProfile } from "@prisma/client";
import { UserProfileData } from "../schemas/userProfile";
import { readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import type { SafetyRule } from "../knowledge/types";

// ---------------------------------------------------------------------------
// Schema for the modifier output
// ---------------------------------------------------------------------------

const ModifierOutputSchema = z.object({
  plan: PlanSchema,
  changeSummary: z.string(),
});

type ModifierOutput = z.infer<typeof ModifierOutputSchema>;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PlanEditChange {
  type: "update_task" | "delete_task" | "add_task" | "swap_days" | "skip_day";
  weekIndex: number;
  dayIndex: number;
  taskIndex?: number;
  data?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROMPT_VERSION = "v1.0.0";

function loadPrompt(): string {
  try {
    const promptPath = join(process.cwd(), "prompts", "plan_modifier.md");
    const content = readFileSync(promptPath, "utf-8");
    console.log(
      `[PlanModifier] Loaded prompt ${PROMPT_VERSION} from ${promptPath} (${content.length} chars)`,
    );
    return content;
  } catch (error) {
    console.warn(
      `[PlanModifier] Failed to load prompt file, using fallback:`,
      error,
    );
    return getFallbackPrompt();
  }
}

function getFallbackPrompt(): string {
  return `You are a plan modification agent. You receive a current plan and a modification request.
Apply the requested change to the plan while preserving the overall structure.
Return a JSON object with two fields:
- "plan": the complete modified plan (same schema as input)
- "changeSummary": a brief description of what was changed
Return ONLY valid JSON.`;
}

/**
 * Build a human-readable constraint summary string for the LLM prompt.
 * Same format as planGenerator.
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
 * Get the system prompt for the modifier LLM call.
 */
function getSystemPrompt(): string {
  return `You are a plan modification agent. You MUST return ONLY valid JSON, no markdown, no explanations, no code blocks.

The JSON must have exactly two fields:
1. "plan" - the COMPLETE modified plan (same schema as the input plan)
2. "changeSummary" - a brief description of what was changed

CRITICAL REQUIREMENTS for the plan:
- Each DAY must have: day_index (number), date (string "YYYY-MM-DD"), tasks (array of task objects)
- Each TASK must have: title, type, duration_min, instructions (array), done_criteria (array), fallback (object)
- Do NOT return tasks as strings
- Do NOT omit the "date" field on any day
- Return the COMPLETE plan, not just the changed parts`;
}

/**
 * Create a new PlanVersion record and update the Plan record.
 */
async function savePlanVersion(input: {
  planId: string;
  plan: Plan;
  changeSource: "chat" | "direct_edit";
  changeSummary: string;
}): Promise<{ versionId: string; newVersion: number }> {
  const latestVersion = await prisma.planVersion.findFirst({
    where: { planId: input.planId },
    orderBy: { version: "desc" },
  });
  const newVersion = (latestVersion?.version ?? 0) + 1;

  console.log(
    `[PlanModifier] Creating version ${newVersion} for plan ${input.planId} (source: ${input.changeSource})`,
  );

  const planVersion = await prisma.planVersion.create({
    data: {
      planId: input.planId,
      version: newVersion,
      content: input.plan as any,
      changeSource: input.changeSource,
      changeSummary: input.changeSummary,
    },
  });

  await prisma.plan.update({
    where: { id: input.planId },
    data: {
      planJson: input.plan as any,
      version: newVersion,
    },
  });

  console.log(
    `[PlanModifier] Saved version ${newVersion} (id: ${planVersion.id})`,
  );

  return { versionId: planVersion.id, newVersion };
}

/**
 * Load safety rules for a domain, returning an empty array on failure.
 */
function loadSafetyRules(domain?: string): SafetyRule[] {
  if (!domain) return [];
  try {
    const knowledge = getKnowledge(domain);
    return knowledge.safetyRules ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Modify a plan via natural language chat request.
 * Uses the LLM to interpret the request and apply changes.
 */
export async function modifyPlanByChat(input: {
  planId: string;
  currentPlan: Plan;
  request: string;
  goalSpec: GoalSpec;
  occupiedSlots: OccupiedSlot[];
  userProfile: UserProfileData;
}): Promise<{
  plan: Plan;
  changeSummary: string;
  violations: ConstraintViolation[];
  versionId: string;
}> {
  console.log(
    `[PlanModifier] modifyPlanByChat for plan ${input.planId}: "${input.request}"`,
  );

  // 1. Load prompt template
  const promptTemplate = loadPrompt();

  // 2. Build constraint summary
  const constraintSummary = buildConstraintSummary(
    input.goalSpec,
    input.occupiedSlots,
  );

  // 3. Build domain knowledge
  const domain = input.goalSpec.domain ?? input.goalSpec.category ?? "general";
  let domainKnowledge: string;
  try {
    domainKnowledge = getKnowledgeForPrompt(domain);
  } catch {
    console.warn(
      `[PlanModifier] No domain knowledge found for "${domain}", using empty`,
    );
    domainKnowledge = "No domain-specific knowledge available.";
  }

  // 4. Replace placeholders
  const prompt = promptTemplate
    .replace("{{CURRENT_PLAN}}", JSON.stringify(input.currentPlan, null, 2))
    .replace("{{MODIFICATION_REQUEST}}", input.request)
    .replace("{{CONSTRAINTS}}", constraintSummary)
    .replace("{{DOMAIN_KNOWLEDGE}}", domainKnowledge);

  console.log(
    `[PlanModifier] Prompt built (${prompt.length} chars), calling LLM...`,
  );

  // 5. Call JSONGuard with ModifierOutputSchema
  const guard = new JSONGuard({
    maxRetries: 2,
    schemaName: "plan_modifier_output",
  });

  const result = await guard.callAndValidate<ModifierOutput>(
    prompt,
    getSystemPrompt(),
    ModifierOutputSchema,
  );

  const modifiedPlan = result.plan;
  console.log(
    `[PlanModifier] LLM returned modified plan. Summary: "${result.changeSummary}"`,
  );

  // 6. Validate the modified plan
  const safetyRules = loadSafetyRules(domain);
  const constraints: StructuredConstraints =
    input.goalSpec.structuredConstraints ?? {};
  const validationResult = validatePlan(
    modifiedPlan,
    constraints,
    input.userProfile,
    input.occupiedSlots,
    safetyRules,
  );

  if (validationResult.violations.length > 0) {
    console.warn(
      `[PlanModifier] Modified plan has ${validationResult.violations.length} violation(s):`,
      validationResult.violations.map((v) => v.message),
    );
  } else {
    console.log(`[PlanModifier] Modified plan passed validation`);
  }

  // 7. Save version and update plan
  const { versionId } = await savePlanVersion({
    planId: input.planId,
    plan: modifiedPlan,
    changeSource: "chat",
    changeSummary: result.changeSummary,
  });

  return {
    plan: modifiedPlan,
    changeSummary: result.changeSummary,
    violations: validationResult.violations,
    versionId,
  };
}

/**
 * Modify a plan via direct edits from the card UI.
 * Applies changes programmatically without LLM involvement.
 */
export async function modifyPlanByEdit(input: {
  planId: string;
  currentPlan: Plan;
  changes: PlanEditChange[];
  goalSpec: GoalSpec;
  occupiedSlots: OccupiedSlot[];
}): Promise<{
  plan: Plan;
  changeSummary: string;
  violations: ConstraintViolation[];
  versionId: string;
}> {
  console.log(
    `[PlanModifier] modifyPlanByEdit for plan ${input.planId}: ${input.changes.length} change(s)`,
  );

  // Deep clone the plan to avoid mutating the original
  const modifiedPlan: Plan = JSON.parse(JSON.stringify(input.currentPlan));
  const summaryParts: string[] = [];

  // Apply each change
  for (const change of input.changes) {
    console.log(
      `[PlanModifier] Applying ${change.type} at week=${change.weekIndex} day=${change.dayIndex}`,
    );

    const week = modifiedPlan.weeks[change.weekIndex];
    if (!week) {
      console.warn(
        `[PlanModifier] Week index ${change.weekIndex} out of range, skipping`,
      );
      continue;
    }

    const dayIdx = week.days.findIndex(
      (d) => d.day_index === change.dayIndex,
    );
    if (dayIdx === -1 && change.type !== "swap_days") {
      console.warn(
        `[PlanModifier] Day index ${change.dayIndex} not found in week ${change.weekIndex}, skipping`,
      );
      continue;
    }

    switch (change.type) {
      case "update_task": {
        const day = week.days[dayIdx];
        const tIdx = change.taskIndex ?? 0;
        if (tIdx < 0 || tIdx >= day.tasks.length) {
          console.warn(
            `[PlanModifier] Task index ${tIdx} out of range for day ${change.dayIndex}`,
          );
          break;
        }
        if (change.data) {
          day.tasks[tIdx] = { ...day.tasks[tIdx], ...change.data };
          summaryParts.push(
            `Updated task "${day.tasks[tIdx].title}" on day ${change.dayIndex}`,
          );
        }
        break;
      }

      case "delete_task": {
        const day = week.days[dayIdx];
        const tIdx = change.taskIndex ?? 0;
        if (tIdx < 0 || tIdx >= day.tasks.length) {
          console.warn(
            `[PlanModifier] Task index ${tIdx} out of range for day ${change.dayIndex}`,
          );
          break;
        }
        const removed = day.tasks.splice(tIdx, 1)[0];
        summaryParts.push(
          `Deleted task "${removed.title}" from day ${change.dayIndex}`,
        );
        // If no tasks remain, add a rest day placeholder
        if (day.tasks.length === 0) {
          day.tasks.push(makeRestTask());
          summaryParts.push(
            `Day ${change.dayIndex} is now a rest day`,
          );
        }
        break;
      }

      case "add_task": {
        const day = week.days[dayIdx];
        if (!change.data) {
          console.warn(
            `[PlanModifier] add_task requires data, skipping`,
          );
          break;
        }
        const newTask = {
          title: change.data.title ?? "New Task",
          type: (change.data.type as any) ?? "habit",
          duration_min: change.data.duration_min ?? 30,
          instructions: change.data.instructions ?? [
            "Complete the task",
            "Log your progress",
          ],
          done_criteria: change.data.done_criteria ?? [
            "Task completed",
            "Progress logged",
          ],
          fallback: change.data.fallback ?? {
            min_version: "Shortened version",
            duration_min: 10,
          },
          ...(change.data.specificValues && {
            specificValues: change.data.specificValues,
          }),
          ...(change.data.timeSlot && {
            timeSlot: change.data.timeSlot,
          }),
        };
        const insertAt = change.taskIndex ?? day.tasks.length;
        day.tasks.splice(insertAt, 0, newTask);
        summaryParts.push(
          `Added task "${newTask.title}" to day ${change.dayIndex}`,
        );
        break;
      }

      case "swap_days": {
        // change.data.targetDayIndex specifies the other day to swap with
        const targetDayIndex = change.data?.targetDayIndex;
        if (targetDayIndex == null) {
          console.warn(
            `[PlanModifier] swap_days requires data.targetDayIndex, skipping`,
          );
          break;
        }
        // Find both days across all weeks
        let dayA: Plan["weeks"][0]["days"][0] | null = null;
        let dayB: Plan["weeks"][0]["days"][0] | null = null;
        for (const w of modifiedPlan.weeks) {
          for (const d of w.days) {
            if (d.day_index === change.dayIndex) dayA = d;
            if (d.day_index === targetDayIndex) dayB = d;
          }
        }
        if (!dayA || !dayB) {
          console.warn(
            `[PlanModifier] Could not find both days for swap (${change.dayIndex} <-> ${targetDayIndex})`,
          );
          break;
        }
        // Swap tasks (keep day_index and date in place)
        const tempTasks = dayA.tasks;
        dayA.tasks = dayB.tasks;
        dayB.tasks = tempTasks;
        summaryParts.push(
          `Swapped tasks between day ${change.dayIndex} and day ${targetDayIndex}`,
        );
        break;
      }

      case "skip_day": {
        const day = week.days[dayIdx];
        day.tasks = [makeRestTask()];
        // Remove assessment if present
        if ((day as any).assessment) {
          delete (day as any).assessment;
        }
        summaryParts.push(
          `Skipped day ${change.dayIndex} (now a rest day)`,
        );
        break;
      }

      default: {
        console.warn(
          `[PlanModifier] Unknown change type: ${(change as any).type}`,
        );
      }
    }
  }

  const changeSummary =
    summaryParts.length > 0
      ? summaryParts.join("; ")
      : "No changes applied";

  console.log(`[PlanModifier] Changes applied: ${changeSummary}`);

  // Validate the modified plan
  const domain = input.goalSpec.domain ?? input.goalSpec.category ?? "general";
  const safetyRules = loadSafetyRules(domain);
  const constraints: StructuredConstraints =
    input.goalSpec.structuredConstraints ?? {};
  const validationResult = validatePlan(
    modifiedPlan,
    constraints,
    {} as UserProfileData,
    input.occupiedSlots,
    safetyRules,
  );

  if (validationResult.violations.length > 0) {
    console.warn(
      `[PlanModifier] Edited plan has ${validationResult.violations.length} violation(s):`,
      validationResult.violations.map((v) => v.message),
    );
  } else {
    console.log(`[PlanModifier] Edited plan passed validation`);
  }

  // Save version and update plan
  const { versionId } = await savePlanVersion({
    planId: input.planId,
    plan: modifiedPlan,
    changeSource: "direct_edit",
    changeSummary,
  });

  return {
    plan: modifiedPlan,
    changeSummary,
    violations: validationResult.violations,
    versionId,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Create a rest day placeholder task.
 * Used when all tasks are removed from a day or when skipping a day.
 */
function makeRestTask() {
  return {
    title: "Rest Day",
    type: "habit" as const,
    duration_min: 5,
    instructions: [
      "Take a full rest day",
      "Light stretching or walking is OK",
    ],
    done_criteria: ["Rested", "Ready for next session"],
    fallback: {
      min_version: "Complete rest",
      duration_min: 0,
    },
  };
}
