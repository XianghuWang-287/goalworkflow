import { z } from "zod";

export const TaskSchema = z.object({
  title: z.string(),
  type: z.enum(["learn", "practice", "habit", "assessment"]),
  duration_min: z.number().int().positive(),
  instructions: z.array(z.string()),
  deliverable: z.string().optional(), // What to produce/show
  done_criteria: z.array(z.string()),
  fallback: z.object({
    min_version: z.string(), // Simplified version of task
    duration_min: z.number().int().positive(),
  }),
});

export const DaySchema = z.object({
  day_index: z.number().int().min(0).max(6),
  date: z.string(), // ISO date string
  tasks: z.array(TaskSchema).min(1), // At least 1 task per day (1 for simple habits, 2+ for learning goals)
  assessment: z.object({
    type: z.enum(["quiz", "coding_task", "reflection"]),
    title: z.string(),
    instructions: z.array(z.string()),
    pass_rule: z.string(), // Clear criteria for passing
  }).optional(), // Only on day 7
});

export const PlanSchema = z.object({
  version: z.number().int().default(1),
  start_date: z.string(), // ISO date string
  weeks: z.array(z.object({
    week_index: z.number().int().min(0),
    days: z.array(DaySchema).length(7), // Exactly 7 days
  })),
});

export type Plan = z.infer<typeof PlanSchema>;
export type Day = z.infer<typeof DaySchema>;
export type Task = z.infer<typeof TaskSchema>;
