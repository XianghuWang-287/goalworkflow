import { z } from "zod";

export const GoalSpecSchema = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  timeframe: z.string().optional(), // e.g., "7 days", "1 month"
  currentLevel: z.string().optional(), // User's current level/state
  desiredOutcome: z.string().optional(), // What they want to achieve
  constraints: z.array(z.string()).optional(), // Any constraints
});

export type GoalSpec = z.infer<typeof GoalSpecSchema>;
