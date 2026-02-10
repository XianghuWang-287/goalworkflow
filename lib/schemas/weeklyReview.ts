import { z } from "zod";

export const PhaseInfoSchema = z.object({
  phase_name: z.string(),
  phase_progress: z.string(), // e.g., "Week 3 of 4"
  transition_recommended: z.boolean(),
  transition_reason: z.string(),
});

export const WeeklyReviewSchema = z.object({
  week_index: z.number().int().min(0),
  phase_info: PhaseInfoSchema.optional(), // Phase-aware review data
  metrics: z.object({
    completion_rate: z.number().min(0).max(1), // 0-1
    total_checkins: z.number().int().min(0),
    done_count: z.number().int().min(0),
    partial_count: z.number().int().min(0),
    missed_count: z.number().int().min(0),
    streak_days: z.number().int().min(0),
  }),
  blockers: z.array(z.string()), // What blocked progress
  wins: z.array(z.string()), // What went well
  next_week_options: z.array(z.object({
    label: z.string(), // "稳妥", "更快", "更轻松"
    description: z.string(),
    plan_patch: z.any(), // Partial plan JSON or full plan
  })).length(3), // Exactly 3 options
});

export type WeeklyReview = z.infer<typeof WeeklyReviewSchema>;
