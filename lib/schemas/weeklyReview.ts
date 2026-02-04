import { z } from "zod";

export const WeeklyReviewSchema = z.object({
  week_index: z.number().int().min(0),
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
