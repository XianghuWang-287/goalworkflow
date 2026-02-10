import { z } from "zod";

export const ConversationMessageSchema = z.object({
  role: z.enum(["assistant", "user"]),
  content: z.string(),
  timestamp: z.string(),
  options: z.array(z.string()).optional(),
});

export const ExpertTurnResultSchema = z.object({
  message: z.string(),
  options: z.array(z.string()).optional(),
  done: z.boolean(),
  goalSpec: z.any().optional(),
  profileUpdates: z.record(z.any()).optional(),
});

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type ExpertTurnResult = z.infer<typeof ExpertTurnResultSchema>;
