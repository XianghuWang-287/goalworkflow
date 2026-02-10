/**
 * WeeklyReviewer Agent
 * Analyzes past week and generates 3 next-week options
 * Phase-aware: tracks current phase, week within phase, and phase transitions
 */

import { JSONGuard } from "../llm/jsonGuard";
import { WeeklyReviewSchema, WeeklyReview } from "../schemas/weeklyReview";
import { Plan, Phase } from "../schemas/plan";
import { readFileSync } from "fs";
import { join } from "path";

const PROMPT_VERSION = "v2.0.0";

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

// --- Phase-aware types and helpers ---

export interface PhaseInfo {
  currentPhase: number;
  currentWeek: number;
  phaseName: string;
  phaseFocus: string;
  phaseWeeksTotal: number;
  weekWithinPhase: number;
  totalPhases: number;
  totalDuration?: number;
}

export interface TaskCompletionDetail {
  title: string;
  status: "done" | "partial" | "missed";
  specificValues?: Record<string, any>;
  timeSlot?: string;
}

/**
 * Determine if a phase transition should happen based on completion rate
 * and current position within the plan.
 */
export function shouldTransitionPhase(
  plan: Plan,
  currentPhase: number,
  completionRate: number
): { shouldTransition: boolean; reason: string } {
  const phases = plan.phases;
  if (!phases || phases.length === 0) {
    return { shouldTransition: false, reason: "No phases defined in plan" };
  }

  if (currentPhase >= phases.length - 1) {
    return { shouldTransition: false, reason: "Already on the final phase" };
  }

  const phase = phases[currentPhase] as Phase;
  const phaseWeeks = phase.durationWeeks;

  // Calculate how many weeks have been spent in this phase
  // currentWeek is the global week index; we need the week within the phase
  const phaseStartWeek = phases
    .slice(0, currentPhase)
    .reduce((sum: number, p: any) => sum + (p.durationWeeks || 1), 0);

  // Global currentWeek from the plan
  const globalWeek = plan.weeks?.length
    ? Math.max(0, plan.weeks.length - 1)
    : 0;

  const weeksInPhase = globalWeek - phaseStartWeek + 1;

  // Transition if we've completed all weeks in this phase
  if (weeksInPhase >= phaseWeeks) {
    if (completionRate >= 0.5) {
      return {
        shouldTransition: true,
        reason: `Completed ${weeksInPhase}/${phaseWeeks} weeks in "${phase.name}" with ${Math.round(completionRate * 100)}% completion rate. Ready to advance.`,
      };
    }
    return {
      shouldTransition: false,
      reason: `Completed ${weeksInPhase}/${phaseWeeks} weeks in "${phase.name}" but completion rate is only ${Math.round(completionRate * 100)}%. Consider repeating this phase.`,
    };
  }

  // Early transition if doing exceptionally well
  if (weeksInPhase >= Math.ceil(phaseWeeks * 0.75) && completionRate >= 0.9) {
    return {
      shouldTransition: true,
      reason: `Excellent progress (${Math.round(completionRate * 100)}%) after ${weeksInPhase}/${phaseWeeks} weeks in "${phase.name}". Early advancement recommended.`,
    };
  }

  return {
    shouldTransition: false,
    reason: `Week ${weeksInPhase} of ${phaseWeeks} in "${phase.name}". Continue current phase.`,
  };
}

/**
 * Extract phase info from a plan's DB record
 */
export function extractPhaseInfo(plan: {
  currentPhase?: number | null;
  currentWeek?: number | null;
  phases?: any;
  totalDuration?: number | null;
  planJson?: any;
}): PhaseInfo | null {
  const phases = plan.phases as Phase[] | undefined;
  if (!phases || phases.length === 0) return null;

  const currentPhase = plan.currentPhase ?? 0;
  const currentWeek = plan.currentWeek ?? 0;
  const phase = phases[currentPhase];
  if (!phase) return null;

  // Calculate week within the current phase
  const phaseStartWeek = phases
    .slice(0, currentPhase)
    .reduce((sum: number, p: Phase) => sum + (p.durationWeeks || 1), 0);
  const weekWithinPhase = currentWeek - phaseStartWeek;

  return {
    currentPhase,
    currentWeek,
    phaseName: phase.name,
    phaseFocus: phase.focus,
    phaseWeeksTotal: phase.durationWeeks,
    weekWithinPhase: Math.max(0, weekWithinPhase),
    totalPhases: phases.length,
    totalDuration: plan.totalDuration ?? undefined,
  };
}

function getFallbackTemplate(weekIndex: number, phaseInfo?: PhaseInfo | null): WeeklyReview {
  return {
    week_index: weekIndex,
    phase_info: phaseInfo
      ? {
          phase_name: phaseInfo.phaseName,
          phase_progress: `Week ${phaseInfo.weekWithinPhase + 1} of ${phaseInfo.phaseWeeksTotal}`,
          transition_recommended: false,
          transition_reason: "Insufficient data for recommendation",
        }
      : undefined,
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
  /** Phase-aware fields (optional for backward compat) */
  phaseInfo?: PhaseInfo | null;
  taskDetails?: TaskCompletionDetail[];
}

export async function generateWeeklyReview(
  input: WeeklyReviewInput
): Promise<WeeklyReview> {
  const guard = new JSONGuard({
    maxRetries: 2,
    schemaName: "WeeklyReview",
    fallbackTemplate: () => getFallbackTemplate(input.weekIndex, input.phaseInfo),
  });

  const prompt = loadPrompt();

  // Build phase context section
  let phaseContext = "";
  if (input.phaseInfo) {
    const pi = input.phaseInfo;
    phaseContext = `
Phase Information:
- Current Phase: ${pi.currentPhase + 1} of ${pi.totalPhases} — "${pi.phaseName}"
- Phase Focus: ${pi.phaseFocus}
- Week within Phase: ${pi.weekWithinPhase + 1} of ${pi.phaseWeeksTotal}
- Overall Week: ${pi.currentWeek + 1}${pi.totalDuration ? ` of ~${Math.ceil(pi.totalDuration / 7)} total weeks` : ""}
`;
  }

  // Build task detail section
  let taskDetailSection = "";
  if (input.taskDetails && input.taskDetails.length > 0) {
    const taskLines = input.taskDetails.map((t) => {
      const timeInfo = t.timeSlot ? ` @ ${t.timeSlot}` : "";
      const specInfo =
        t.specificValues && Object.keys(t.specificValues).length > 0
          ? ` [${Object.entries(t.specificValues).map(([k, v]) => `${k}: ${v}`).join(", ")}]`
          : "";
      return `  - ${t.title}${timeInfo}${specInfo}: ${t.status}`;
    });
    taskDetailSection = `
Task Completion Details:
${taskLines.join("\n")}
`;
  }

  const userPrompt = `${prompt}

Generate a weekly review for week ${input.weekIndex}:
${phaseContext}
Metrics:
${JSON.stringify(input.metrics, null, 2)}

Check-ins:
${JSON.stringify(input.checkins, null, 2)}
${taskDetailSection}
${input.blockers && input.blockers.length > 0 ? `Blockers: ${input.blockers.join(", ")}` : ""}
${input.wins && input.wins.length > 0 ? `Wins: ${input.wins.join(", ")}` : ""}

Return the WeeklyReview JSON object with 3 next_week_options (稳妥, 更快, 更轻松).${input.phaseInfo ? " Include phase_info with transition recommendation." : ""}`;

  console.log(`[WeeklyReview] Generating review for week ${input.weekIndex}${input.phaseInfo ? `, phase "${input.phaseInfo.phaseName}"` : ""}`);

  const result = await guard.callAndValidate<WeeklyReview>(
    userPrompt,
    getSystemPrompt(),
    WeeklyReviewSchema
  );

  console.log(`[WeeklyReview] Review generated. Completion rate: ${result.metrics.completion_rate}`);
  if (result.phase_info) {
    console.log(`[WeeklyReview] Phase transition recommended: ${result.phase_info.transition_recommended}`);
  }

  return result;
}
