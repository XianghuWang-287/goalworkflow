import { Plan } from "@/lib/schemas/plan";
import { UserProfileData } from "@/lib/schemas/userProfile";
import { GoalSpec } from "@/lib/schemas/goalSpec";
import { SafetyRule } from "@/lib/knowledge/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structured constraints extracted from a GoalSpec */
export type StructuredConstraints = NonNullable<GoalSpec["structuredConstraints"]>;

/** A time slot already occupied by another goal */
export interface OccupiedSlot {
  goalId: string;
  goalTitle: string;
  date: string; // ISO date "YYYY-MM-DD"
  timeSlot: string; // "HH:MM-HH:MM"
}

/** A single constraint violation found during validation */
export interface ConstraintViolation {
  taskIndex: number;
  dayIndex: number;
  type:
    | "unavailable_date"
    | "unavailable_slot"
    | "goal_conflict"
    | "max_daily_minutes"
    | "safety_rule";
  message: string;
}

/** Result returned by validatePlan */
export interface ValidationResult {
  valid: boolean;
  violations: ConstraintViolation[];
}

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/**
 * Parse a time-slot string like "07:00-08:00" into minutes-since-midnight
 * for both start and end.
 */
export function parseTimeSlot(slot: string): { start: number; end: number } {
  const parts = slot.split("-");
  if (parts.length !== 2) {
    throw new Error(`Invalid time slot format: "${slot}". Expected "HH:MM-HH:MM".`);
  }
  return {
    start: timeToMinutes(parts[0].trim()),
    end: timeToMinutes(parts[1].trim()),
  };
}

/**
 * Convert a "HH:MM" string to minutes since midnight.
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) {
    throw new Error(`Invalid time format: "${time}". Expected "HH:MM".`);
  }
  return h * 60 + m;
}

/**
 * Return true if two time ranges overlap.
 * Ranges are half-open: [start, end).
 */
export function timeOverlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Get the day-of-week (0 = Sunday, 6 = Saturday) for an ISO date string
 * such as "2024-03-15". We parse manually to avoid timezone issues with
 * the Date constructor.
 */
export function getDayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  // Construct the date in UTC to avoid local-timezone shifts
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCDay();
}

// ---------------------------------------------------------------------------
// Core validation
// ---------------------------------------------------------------------------

/**
 * Validate a generated plan against user constraints, occupied slots, and
 * optional domain safety rules. This is pure code — no LLM calls.
 */
export function validatePlan(
  plan: Plan,
  constraints: StructuredConstraints,
  userProfile: UserProfileData,
  occupiedSlots: OccupiedSlot[],
  safetyRules?: SafetyRule[],
): ValidationResult {
  const violations: ConstraintViolation[] = [];

  const unavailableDatesSet = new Set(constraints.unavailableDates ?? []);

  for (const week of plan.weeks) {
    for (const day of week.days) {
      const dayIndex = day.day_index;
      const dateStr = day.date;
      const dayOfWeek = getDayOfWeek(dateStr);

      // ------------------------------------------------------------------
      // 1. Unavailable dates check
      // ------------------------------------------------------------------
      if (unavailableDatesSet.has(dateStr)) {
        violations.push({
          taskIndex: -1, // applies to all tasks on this day
          dayIndex,
          type: "unavailable_date",
          message: `Date ${dateStr} is marked as unavailable.`,
        });
      }

      // Per-day accumulators for max-daily-minutes check
      let dailyMinutes = 0;

      for (let taskIdx = 0; taskIdx < day.tasks.length; taskIdx++) {
        const task = day.tasks[taskIdx];
        dailyMinutes += task.duration_min;

        // Only run time-slot checks when the task has a timeSlot
        if (task.timeSlot) {
          let parsedSlot: { start: number; end: number };
          try {
            parsedSlot = parseTimeSlot(task.timeSlot);
          } catch {
            // Malformed slot — skip time-based checks for this task
            continue;
          }

          // ----------------------------------------------------------------
          // 2a. Unavailable slots check (from structuredConstraints)
          // ----------------------------------------------------------------
          if (constraints.unavailableSlots) {
            for (const uSlot of constraints.unavailableSlots) {
              if (uSlot.dayOfWeek === dayOfWeek) {
                const uRange = {
                  start: timeToMinutes(uSlot.start),
                  end: timeToMinutes(uSlot.end),
                };
                if (timeOverlaps(parsedSlot, uRange)) {
                  violations.push({
                    taskIndex: taskIdx,
                    dayIndex,
                    type: "unavailable_slot",
                    message:
                      `Task "${task.title}" at ${task.timeSlot} on ${dateStr} ` +
                      `overlaps with unavailable slot ${uSlot.start}-${uSlot.end} ` +
                      `(day-of-week ${uSlot.dayOfWeek}).`,
                  });
                }
              }
            }
          }

          // ----------------------------------------------------------------
          // 2b. Available slots check (from userProfile)
          // ----------------------------------------------------------------
          if (
            userProfile.availableSlots &&
            userProfile.availableSlots.length > 0
          ) {
            const slotsForDay = userProfile.availableSlots.filter(
              (s) => s.dayOfWeek === dayOfWeek,
            );

            // If the user has defined available slots for this day-of-week,
            // the task must fall within at least one of them.
            if (slotsForDay.length > 0) {
              const fitsAny = slotsForDay.some((avail) => {
                const availRange = {
                  start: timeToMinutes(avail.start),
                  end: timeToMinutes(avail.end),
                };
                // Task must be fully contained within the available range
                return (
                  parsedSlot.start >= availRange.start &&
                  parsedSlot.end <= availRange.end
                );
              });

              if (!fitsAny) {
                violations.push({
                  taskIndex: taskIdx,
                  dayIndex,
                  type: "unavailable_slot",
                  message:
                    `Task "${task.title}" at ${task.timeSlot} on ${dateStr} ` +
                    `does not fit within any of the user's available slots ` +
                    `for day-of-week ${dayOfWeek}.`,
                });
              }
            }
          }

          // ----------------------------------------------------------------
          // 3. Goal conflict check (occupied slots from other goals)
          // ----------------------------------------------------------------
          for (const occ of occupiedSlots) {
            if (occ.date !== dateStr) continue;
            let occRange: { start: number; end: number };
            try {
              occRange = parseTimeSlot(occ.timeSlot);
            } catch {
              continue;
            }
            if (timeOverlaps(parsedSlot, occRange)) {
              violations.push({
                taskIndex: taskIdx,
                dayIndex,
                type: "goal_conflict",
                message:
                  `Task "${task.title}" at ${task.timeSlot} on ${dateStr} ` +
                  `conflicts with "${occ.goalTitle}" (${occ.timeSlot}) ` +
                  `from goal ${occ.goalId}.`,
              });
            }
          }
        }
      } // end task loop

      // ------------------------------------------------------------------
      // 4. Max daily minutes check
      // ------------------------------------------------------------------
      if (
        constraints.maxDailyMinutes != null &&
        dailyMinutes > constraints.maxDailyMinutes
      ) {
        violations.push({
          taskIndex: -1,
          dayIndex,
          type: "max_daily_minutes",
          message:
            `Total task duration on ${dateStr} is ${dailyMinutes} min, ` +
            `which exceeds the limit of ${constraints.maxDailyMinutes} min.`,
        });
      }
    } // end day loop
  } // end week loop

  // --------------------------------------------------------------------
  // 5. Safety rules
  // --------------------------------------------------------------------
  if (safetyRules && safetyRules.length > 0) {
    checkSafetyRules(plan, safetyRules, violations);
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

// ---------------------------------------------------------------------------
// Safety-rule helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to programmatically evaluate common safety-rule patterns.
 * Rules whose `check` field cannot be matched to a known pattern are
 * silently skipped (they will be enforced by the LLM at generation time).
 */
function checkSafetyRules(
  plan: Plan,
  rules: SafetyRule[],
  violations: ConstraintViolation[],
): void {
  for (const rule of rules) {
    const check = rule.check.toLowerCase();

    // Pattern: rest day rules — e.g. "no more than N consecutive days"
    const consecutiveMatch = check.match(
      /no\s+more\s+than\s+(\d+)\s+consecutive\s+day/,
    );
    if (consecutiveMatch) {
      const maxConsecutive = parseInt(consecutiveMatch[1], 10);
      checkConsecutiveDays(plan, maxConsecutive, rule, violations);
      continue;
    }

    // Pattern: rest day every N days — e.g. "rest day every 3 days"
    const restEveryMatch = check.match(/rest\s+day\s+every\s+(\d+)\s+day/);
    if (restEveryMatch) {
      const everyN = parseInt(restEveryMatch[1], 10);
      checkConsecutiveDays(plan, everyN, rule, violations);
      continue;
    }

    // Pattern: min/max value checks on specificValues
    // e.g. "max heart_rate 180" or "minimum weight 0"
    const minMaxMatch = check.match(
      /(min(?:imum)?|max(?:imum)?)\s+(\w+)\s+(\d+(?:\.\d+)?)/,
    );
    if (minMaxMatch) {
      const direction = minMaxMatch[1].startsWith("min") ? "min" : "max";
      const field = minMaxMatch[2];
      const threshold = parseFloat(minMaxMatch[3]);
      checkSpecificValueBounds(plan, field, direction, threshold, rule, violations);
      continue;
    }

    // Unknown pattern — skip (LLM will handle at generation time)
  }
}

/**
 * Check that the plan does not have more than `maxConsecutive` training days
 * in a row without a rest day. A "rest day" is a day_index that is absent
 * from the plan.
 */
function checkConsecutiveDays(
  plan: Plan,
  maxConsecutive: number,
  rule: SafetyRule,
  violations: ConstraintViolation[],
): void {
  // Collect all day_indexes that appear in the plan, sorted
  const activeDays: number[] = [];
  for (const week of plan.weeks) {
    for (const day of week.days) {
      activeDays.push(day.day_index);
    }
  }
  activeDays.sort((a, b) => a - b);

  if (activeDays.length === 0) return;

  let consecutiveCount = 1;
  for (let i = 1; i < activeDays.length; i++) {
    if (activeDays[i] === activeDays[i - 1] + 1) {
      consecutiveCount++;
      if (consecutiveCount > maxConsecutive) {
        violations.push({
          taskIndex: -1,
          dayIndex: activeDays[i],
          type: "safety_rule",
          message:
            `Safety rule "${rule.id}": ${consecutiveCount} consecutive ` +
            `active days ending at day_index ${activeDays[i]} exceeds ` +
            `the maximum of ${maxConsecutive}. ${rule.description}`,
        });
        // Only report once per streak
        break;
      }
    } else {
      consecutiveCount = 1;
    }
  }
}

/**
 * Check min/max bounds on a named field inside task.specificValues.
 */
function checkSpecificValueBounds(
  plan: Plan,
  field: string,
  direction: "min" | "max",
  threshold: number,
  rule: SafetyRule,
  violations: ConstraintViolation[],
): void {
  for (const week of plan.weeks) {
    for (const day of week.days) {
      for (let taskIdx = 0; taskIdx < day.tasks.length; taskIdx++) {
        const task = day.tasks[taskIdx];
        if (!task.specificValues) continue;
        const val = task.specificValues[field];
        if (typeof val !== "number") continue;

        const violated =
          direction === "max" ? val > threshold : val < threshold;

        if (violated) {
          violations.push({
            taskIndex: taskIdx,
            dayIndex: day.day_index,
            type: "safety_rule",
            message:
              `Safety rule "${rule.id}": Task "${task.title}" has ` +
              `${field}=${val}, which violates the ${direction} ` +
              `threshold of ${threshold}. ${rule.description}`,
          });
        }
      }
    }
  }
}
