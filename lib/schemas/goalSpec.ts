import { z } from "zod";
import { stringOrArrayToArray } from "./helpers";

export const GoalSpecSchema = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  timeframe: z.string().optional(), // e.g., "7 days", "1 month"
  currentLevel: z.string().optional(), // User's current level/state
  desiredOutcome: z.string().optional(), // What they want to achieve
  constraints: stringOrArrayToArray.optional(), // Any constraints - handles string or array
  domain: z.string().optional(),
  complexity: z.enum(["simple", "medium", "complex"]).optional(),
  planStructure: z.enum(["fixed_cycle", "phased", "countdown"]).optional(),
  successCriteria: stringOrArrayToArray.optional(),
  structuredConstraints: z.object({
    unavailableDates: z.array(z.string()).optional(),
    unavailableSlots: z.array(z.object({
      dayOfWeek: z.number(),
      start: z.string(),
      end: z.string(),
    })).optional(),
    maxDailyMinutes: z.number().optional(),
  }).optional(),
  targetMetrics: z.record(z.object({
    name: z.string(),
    unit: z.string(),
    targetValue: z.number(),
    frequency: z.enum(["daily", "weekly", "end_of_goal"]),
  })).optional(),
  expertAdvice: stringOrArrayToArray.optional(),
  durationDays: z.number().optional(),
});

export type GoalSpec = z.infer<typeof GoalSpecSchema>;
