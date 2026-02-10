import { z } from "zod";

export const DOMAINS = [
  "fitness", "habit", "learning", "finance", "career",
  "creative", "mental", "social", "lifestyle", "quit", "general"
] as const;

export const DomainEnum = z.enum(DOMAINS);
export type Domain = z.infer<typeof DomainEnum>;

export const ClassificationSchema = z.object({
  domain: DomainEnum,
  complexity: z.enum(["simple", "medium", "complex"]),
  planStructure: z.enum(["fixed_cycle", "phased", "countdown"]),
  needsDeepConversation: z.boolean(),
  suggestedDurationDays: z.number().int().positive().optional(),
  reasoning: z.string().optional(),
});

export type Classification = z.infer<typeof ClassificationSchema>;
