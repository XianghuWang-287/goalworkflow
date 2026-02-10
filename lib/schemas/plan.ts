import { z } from "zod";
import { stringOrArrayToArray, stringOrNumberToNumber } from "./helpers";

export const TaskSchema = z.object({
  title: z.string(),
  type: z.enum(["learn", "practice", "habit", "assessment"]),
  duration_min: stringOrNumberToNumber,
  instructions: stringOrArrayToArray,
  deliverable: z.string().optional(), // What to produce/show
  done_criteria: stringOrArrayToArray,
  fallback: z.object({
    min_version: z.string(), // Simplified version of task
    duration_min: stringOrNumberToNumber,
  }),
  specificValues: z.record(z.any()).optional(),
  timeSlot: z.string().optional(),
});

export const DaySchema = z.object({
  day_index: z.preprocess((val) => typeof val === "string" ? parseInt(val, 10) : val, z.number().int().min(0).max(365)),
  date: z.string(), // ISO date string
  tasks: z.array(TaskSchema).min(1), // At least 1 task per day (1 for simple habits, 2+ for learning goals)
  assessment: z.object({
    type: z.enum(["quiz", "coding_task", "reflection"]),
    title: z.string(),
    instructions: stringOrArrayToArray,
    pass_rule: z.string(), // Clear criteria for passing
  }).optional(), // Only on day 7
});

export const PhaseSchema = z.object({
  phaseIndex: z.number().int().min(0),
  name: z.string(),
  durationWeeks: z.number().int().positive(),
  focus: z.string(),
  weeklyTemplate: z.any().optional(),
});

export type Phase = z.infer<typeof PhaseSchema>;

export const PlanSchema = z.object({
  version: z.number().int().default(1),
  start_date: z.string(), // ISO date string
  weeks: z.array(z.object({
    week_index: z.number().int().min(0),
    days: z.array(DaySchema).min(1), // At least 1 day
  })),
  phases: z.array(PhaseSchema).optional(),
  totalDurationDays: z.number().int().positive().optional(),
});

export type Plan = z.infer<typeof PlanSchema>;
export type Day = z.infer<typeof DaySchema>;
export type Task = z.infer<typeof TaskSchema>;
