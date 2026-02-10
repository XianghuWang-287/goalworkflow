# Intelligent Agent Architecture - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade GoalFlow from template-based plan generation to an intelligent multi-agent goal planning system with user profiles, domain knowledge, constraint validation, and plan versioning.

**Architecture:** Five specialized agents (Classifier, Profile Collector, Domain Expert, Plan Generator, Plan Modifier) orchestrated through a fast/deep path split. Structured knowledge bases per domain injected into prompts. Code-level constraint validation. User profiles persisted across goals for cross-goal coordination.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Prisma/PostgreSQL, Zod, xAI (Grok-4), Tailwind/shadcn

**Design Doc:** `docs/plans/2026-02-09-intelligent-agent-architecture-design.md`

---

## Task 1: Database Schema — New Tables + Field Extensions

**Files:**
- Modify: `prisma/schema.prisma`

### Changes

**1a. Add to User model relations:**
```prisma
  profile        UserProfile?
  domainProfiles DomainProfile[]
```

**1b. Add UserProfile model (after User):**
```prisma
model UserProfile {
  id             String   @id @default(cuid())
  userId         String   @unique
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  wakeUpTime     String?
  sleepTime      String?
  workDays       Json?
  availableSlots Json?
  timezone       String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@map("user_profiles")
}
```

**1c. Add DomainProfile model:**
```prisma
model DomainProfile {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  domain    String
  data      Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([userId, domain])
  @@map("domain_profiles")
}
```

**1d. Add Conversation model:**
```prisma
model Conversation {
  id        String   @id @default(cuid())
  goalId    String?
  goal      Goal?    @relation(fields: [goalId], references: [id], onDelete: Cascade)
  agentType String
  messages  Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@map("conversations")
}
```

**1e. Add PlanVersion model:**
```prisma
model PlanVersion {
  id            String   @id @default(cuid())
  planId        String
  plan          Plan     @relation(fields: [planId], references: [id], onDelete: Cascade)
  version       Int
  content       Json
  changeSource  String
  changeSummary String?
  createdAt     DateTime @default(now())
  @@map("plan_versions")
}
```

**1f. Add fields to Goal model:**
```prisma
  domain        String?
  complexity    String?
  planStructure String?
  constraints   Json?
  conversations Conversation[]
```

**1g. Add fields to Plan model:**
```prisma
  phases        Json?
  totalDuration Int?
  currentPhase  Int?     @default(0)
  currentWeek   Int?     @default(0)
  versions      PlanVersion[]
```

**1h. Add fields to Task model:**
```prisma
  specificValues Json?
  timeSlot       String?
```

### Run

```bash
npx prisma generate && npx prisma db push
```

### Commit

```bash
git add prisma/schema.prisma
git commit -m "feat: add UserProfile, DomainProfile, Conversation, PlanVersion + extend Goal/Plan/Task"
```

---

## Task 2: Zod Schemas

**Files:**
- Create: `lib/schemas/classification.ts`
- Create: `lib/schemas/userProfile.ts`
- Create: `lib/schemas/conversation.ts`
- Modify: `lib/schemas/goalSpec.ts`
- Modify: `lib/schemas/plan.ts`

### 2a. Create `lib/schemas/classification.ts`

```typescript
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
```

### 2b. Create `lib/schemas/userProfile.ts`

```typescript
import { z } from "zod";

export const TimeSlotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6), // 0=Sun
  start: z.string(), // "07:00"
  end: z.string(),   // "08:00"
});

export const UserProfileDataSchema = z.object({
  wakeUpTime: z.string().optional(),
  sleepTime: z.string().optional(),
  workDays: z.array(z.number().int().min(0).max(6)).optional(),
  availableSlots: z.array(TimeSlotSchema).optional(),
  timezone: z.string().optional(),
});

export type UserProfileData = z.infer<typeof UserProfileDataSchema>;
export type TimeSlot = z.infer<typeof TimeSlotSchema>;
```

### 2c. Create `lib/schemas/conversation.ts`

```typescript
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
```

### 2d. Extend `lib/schemas/goalSpec.ts`

Add new fields to GoalSpecSchema:

```typescript
// Add to existing schema
  domain: z.string().optional(),
  complexity: z.enum(["simple", "medium", "complex"]).optional(),
  planStructure: z.enum(["fixed_cycle", "phased", "countdown"]).optional(),
  successCriteria: z.array(z.string()).optional(),
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
  expertAdvice: z.array(z.string()).optional(),
  durationDays: z.number().optional(),
```

### 2e. Extend `lib/schemas/plan.ts`

Update PlanSchema to support variable weeks and phases:

```typescript
// Update weeks to not require exactly 7 days
// Add phase support
export const PhaseSchema = z.object({
  phaseIndex: z.number().int().min(0),
  name: z.string(),
  durationWeeks: z.number().int().positive(),
  focus: z.string(),
  weeklyTemplate: z.any().optional(),
});

// Update TaskSchema to add specificValues and timeSlot
  specificValues: z.record(z.any()).optional(),
  timeSlot: z.string().optional(),

// Update PlanSchema
  phases: z.array(PhaseSchema).optional(),
  totalDurationDays: z.number().int().positive().optional(),
```

### Commit

```bash
git add lib/schemas/
git commit -m "feat: add classification, userProfile, conversation schemas + extend goalSpec/plan"
```

---

## Task 3: Knowledge Base Framework + Initial Data

**Files:**
- Create: `lib/knowledge/types.ts`
- Create: `lib/knowledge/provider.ts`
- Create: `lib/knowledge/_base.json`
- Create: `lib/knowledge/fitness.json`
- Create: `lib/knowledge/habit.json`
- Create: `lib/knowledge/learning.json`
- Create: `lib/knowledge/finance.json`
- Create: `lib/knowledge/career.json`
- Create: `lib/knowledge/mental.json`
- Create: `lib/knowledge/creative.json`
- Create: `lib/knowledge/social.json`
- Create: `lib/knowledge/lifestyle.json`
- Create: `lib/knowledge/quit.json`

### 3a. Create `lib/knowledge/types.ts`

```typescript
export interface DomainKnowledge {
  domain: string;
  displayName: string;
  expertPersona: string;
  profileQuestions: ProfileQuestion[];
  keyQuestions: string[];
  safetyRules: SafetyRule[];
  referenceData: Record<string, any>;
  phaseTemplates?: PhaseTemplate[];
  planGuidelines: string;
}

export interface ProfileQuestion {
  field: string;
  question: string;
  type: "text" | "select" | "number";
  options?: string[];
  required: boolean;
}

export interface SafetyRule {
  id: string;
  description: string;
  check: string; // Description of what to validate
  severity: "error" | "warning";
}

export interface PhaseTemplate {
  name: string;
  durationWeeks: number;
  focus: string;
  intensityLevel: number; // 1-10
}
```

### 3b. Create `lib/knowledge/provider.ts`

```typescript
import { DomainKnowledge } from "./types";
import { readFileSync } from "fs";
import { join } from "path";

const cache = new Map<string, DomainKnowledge>();

export function getKnowledge(domain: string): DomainKnowledge {
  if (cache.has(domain)) return cache.get(domain)!;
  try {
    const path = join(process.cwd(), "lib", "knowledge", `${domain}.json`);
    const data = JSON.parse(readFileSync(path, "utf-8"));
    cache.set(domain, data);
    return data;
  } catch {
    // Fall back to base knowledge
    if (domain !== "_base") {
      const base = getKnowledge("_base");
      cache.set(domain, base);
      return base;
    }
    throw new Error("Base knowledge file not found");
  }
}

export function getKnowledgeForPrompt(domain: string): string {
  const knowledge = getKnowledge(domain);
  return [
    `## Expert Persona\n${knowledge.expertPersona}`,
    `## Key Questions to Ask\n${knowledge.keyQuestions.map((q, i) => `${i+1}. ${q}`).join("\n")}`,
    `## Safety Rules\n${knowledge.safetyRules.map(r => `- ${r.description}`).join("\n")}`,
    `## Plan Guidelines\n${knowledge.planGuidelines}`,
    knowledge.referenceData ? `## Reference Data\n${JSON.stringify(knowledge.referenceData, null, 2)}` : "",
  ].filter(Boolean).join("\n\n");
}
```

### 3c-3m. Create domain JSON files

Each JSON file follows the `DomainKnowledge` interface. Key files:

**`_base.json`**: General goal-setting knowledge (SMART goals, time management, motivation).

**`fitness.json`**: Exercise database (30+ exercises with calories/30min), BMR/TDEE formulas, macronutrient guidelines, safety rules (max 1kg/week, min calories), 3-phase template (adaptation → building → intensification).

**`habit.json`**: Habit loop (cue-routine-reward), 21/66 day research, implementation intentions, habit stacking, environment design tips.

**`learning.json`**: Spaced repetition, active recall, Pomodoro, Bloom's taxonomy, project-based learning, skill stages (novice → expert).

**`finance.json` through `quit.json`**: Lighter versions with expert persona, key questions, basic safety rules, and plan guidelines.

### Commit

```bash
git add lib/knowledge/
git commit -m "feat: add knowledge base framework with 11 domain files"
```

---

## Task 4: Goal Classifier Agent

**Files:**
- Create: `lib/agents/goalClassifier.ts`
- Create: `prompts/goal_classifier.md`

### 4a. Create `prompts/goal_classifier.md`

Prompt instructs LLM to classify a goal into:
- domain (one of 10 + general)
- complexity (simple/medium/complex)
- planStructure (fixed_cycle/phased/countdown)
- needsDeepConversation (boolean)
- suggestedDurationDays

With examples for each category and clear rules for when deep conversation is needed.

### 4b. Create `lib/agents/goalClassifier.ts`

```typescript
import { Classification, ClassificationSchema } from "../schemas/classification";
import { JSONGuard } from "../llm/jsonGuard";

// Zero-latency keyword-based pre-classification
export function preClassify(title: string): {
  likelySimple: boolean;
  likelyDomain: string | null;
} {
  const lower = title.toLowerCase();
  const simplePatterns = [
    /早睡|sleep earl|早起|wake up|喝水|drink water|冥想|meditat/,
    /读书|read.*book|日记|journal|散步|walk/,
  ];
  const isLikelySimple = simplePatterns.some(p => p.test(lower));

  // Domain detection
  const domainPatterns: [RegExp, string][] = [
    [/减肥|瘦|lose weight|健身|gym|exercise|muscle|增肌|跑步|run/, "fitness"],
    [/学|learn|study|考|exam|编程|code|python|react/, "learning"],
    [/存钱|理财|save|budget|invest|记账/, "finance"],
    [/求职|面试|interview|简历|resume|job/, "career"],
    [/戒|quit|stop.*ing|不再/, "quit"],
    [/写|画|创作|write|draw|paint|music/, "creative"],
    [/焦虑|压力|stress|冥想|meditat|心理/, "mental"],
  ];
  const domain = domainPatterns.find(([p]) => p.test(lower))?.[1] ?? null;

  return { likelySimple: isLikelySimple, likelyDomain: domain };
}

// Full LLM classification
export async function classifyGoal(
  title: string,
  category?: string
): Promise<Classification> {
  const guard = new JSONGuard({
    maxRetries: 1,
    schemaName: "Classification",
    fallbackTemplate: () => ({
      domain: "general",
      complexity: "medium",
      planStructure: "fixed_cycle",
      needsDeepConversation: true,
      suggestedDurationDays: 21,
    }),
  });
  // Load prompt, call LLM, validate with ClassificationSchema
  // ... implementation
}
```

### Commit

```bash
git add lib/agents/goalClassifier.ts prompts/goal_classifier.md
git commit -m "feat: add Goal Classifier with rule-based pre-classification"
```

---

## Task 5: User Profile System

**Files:**
- Create: `lib/profile/profileManager.ts`
- Create: `app/api/profile/route.ts`

### 5a. Create `lib/profile/profileManager.ts`

```typescript
export async function getOrCreateProfile(userId: string): Promise<UserProfile>
export async function updateProfile(userId: string, data: Partial<UserProfileData>): Promise<UserProfile>
export async function getDomainProfile(userId: string, domain: string): Promise<DomainProfile | null>
export async function updateDomainProfile(userId: string, domain: string, data: any): Promise<DomainProfile>
export function getMissingProfileFields(profile: UserProfile | null, domainProfile: DomainProfile | null, domain: string, knowledge: DomainKnowledge): string[]
export async function getOccupiedTimeSlots(userId: string, excludeGoalId?: string): Promise<OccupiedSlot[]>
```

`getOccupiedTimeSlots` queries all active goals' tasks to find occupied time slots for conflict detection.

### 5b. Create `app/api/profile/route.ts`

- GET: Return user profile + domain profiles
- PUT: Update profile fields

### Commit

```bash
git add lib/profile/ app/api/profile/
git commit -m "feat: add user profile manager with cross-goal time slot tracking"
```

---

## Task 6: Constraint Validator

**Files:**
- Create: `lib/validators/constraintValidator.ts`

### 6a. Create `lib/validators/constraintValidator.ts`

```typescript
export interface ConstraintViolation {
  taskIndex: number;
  dayIndex: number;
  type: "unavailable_date" | "unavailable_slot" | "goal_conflict" | "safety_rule";
  message: string;
}

export function validatePlan(
  plan: Plan,
  constraints: StructuredConstraints,
  userProfile: UserProfileData,
  occupiedSlots: OccupiedSlot[],
  safetyRules?: SafetyRule[]
): { valid: boolean; violations: ConstraintViolation[] }
```

Pure code validation:
1. Check each task date against `constraints.unavailableDates`
2. Check each task timeSlot against user's `availableSlots`
3. Check each task timeSlot against `occupiedSlots` from other goals
4. Check domain safety rules (if provided)

### Commit

```bash
git add lib/validators/
git commit -m "feat: add code-level constraint validator"
```

---

## Task 7: Domain Expert Agent

**Files:**
- Create: `lib/agents/domainExpert.ts`
- Create: `prompts/domain_expert.md`

### 7a. Create `prompts/domain_expert.md`

Template with placeholders:
- `{{EXPERT_PERSONA}}` — from knowledge base
- `{{DOMAIN_KNOWLEDGE}}` — key questions, safety rules, reference data
- `{{USER_PROFILE}}` — existing profile data
- `{{ACTIVE_GOALS}}` — other goals for conflict awareness
- `{{CONVERSATION_HISTORY}}` — prior messages

Instructions: ask one question at a time, use domain knowledge for specific advice (numbers, not vague), respect constraints, output JSON with message/options/done/goalSpec.

### 7b. Create `lib/agents/domainExpert.ts`

```typescript
export async function startExpertConversation(
  goalTitle: string,
  classification: Classification,
  userProfile: UserProfile | null,
  domainProfile: DomainProfile | null,
  activeGoals: Goal[]
): Promise<{ conversationId: string; firstTurn: ExpertTurnResult }>

export async function continueExpertConversation(
  conversationId: string,
  userMessage: string
): Promise<ExpertTurnResult>
```

- Loads knowledge via `getKnowledge(classification.domain)`
- Builds system prompt from template + knowledge + profile
- Stores messages in Conversation table
- When `done=true`, extracts structured GoalSpec from conversation
- Caps at 15 turns

### Commit

```bash
git add lib/agents/domainExpert.ts prompts/domain_expert.md
git commit -m "feat: add Domain Expert agent with multi-turn conversation"
```

---

## Task 8: Rewrite Plan Generator

**Files:**
- Modify: `lib/agents/planGenerator.ts`
- Modify: `prompts/plan_generator.md`
- Modify: `lib/schemas/plan.ts`

### 8a. Rewrite `prompts/plan_generator.md`

Support three plan structures, variable duration, specific values per task, domain knowledge injection, constraint list.

### 8b. Rewrite `lib/agents/planGenerator.ts`

```typescript
export async function generatePlan(input: {
  goalSpec: GoalSpec;
  classification: Classification;
  userProfile: UserProfileData;
  domainProfile?: DomainProfile;
  occupiedSlots: OccupiedSlot[];
}): Promise<{ plan: Plan; violations: ConstraintViolation[] }>

// Fast path for simple goals
export async function generateSimplePlan(input: {
  title: string;
  userProfile: UserProfileData;
  occupiedSlots: OccupiedSlot[];
}): Promise<{ plan: Plan; classification: Classification; goalSpec: GoalSpec }>
```

Generation loop:
1. Build prompt with GoalSpec + knowledge + constraints
2. Call LLM → validate JSON
3. Run constraintValidator
4. If violations, retry with feedback (max 3)
5. Create PlanVersion v1

### Commit

```bash
git add lib/agents/planGenerator.ts prompts/plan_generator.md lib/schemas/plan.ts
git commit -m "feat: rewrite plan generator with constraint validation + multi-structure"
```

---

## Task 9: Plan Modifier Agent

**Files:**
- Create: `lib/agents/planModifier.ts`
- Create: `prompts/plan_modifier.md`

### 9a. Create prompt and agent

Handles natural language modifications ("把运动改到晚上", "周三到周五出差") and direct edits (card UI). Both paths validate through constraintValidator. Creates new PlanVersion on each modification.

### Commit

```bash
git add lib/agents/planModifier.ts prompts/plan_modifier.md
git commit -m "feat: add Plan Modifier agent"
```

---

## Task 10: Orchestrator + API Routes

**Files:**
- Create: `lib/orchestrator/goalCreationFlow.ts`
- Modify: `app/api/goals/analyze/route.ts`
- Modify: `app/api/goals/create/route.ts`
- Create: `app/api/goals/conversation/route.ts`

### 10a. Create `lib/orchestrator/goalCreationFlow.ts`

Central orchestrator that coordinates all agents:

```typescript
// Fast path
export async function createGoalFastPath(userId, title, category?)
// Deep path
export async function startDeepPath(userId, title, category?)
export async function continueDeepPath(conversationId, userMessage)
export async function finalizePlan(userId, goalId, goalSpec, classification)
```

### 10b. Update API routes

- `/api/goals/analyze` → uses classifier, returns classification + first conversation turn if deep
- `/api/goals/create` → uses orchestrator, supports both paths
- `/api/goals/conversation` (new) → POST to continue expert conversation

### Commit

```bash
git add lib/orchestrator/ app/api/goals/
git commit -m "feat: add goal creation orchestrator with fast/deep routing"
```

---

## Task 11: Frontend — Goal Creation Flow

**Files:**
- Modify: `app/goals/create/page.tsx`
- Create: `components/chat-conversation.tsx`
- Create: `components/plan-preview.tsx`
- Create: `components/task-card.tsx`

### 11a. ChatConversation component

Chat UI: message bubbles, quick-select buttons, text input, progress indicator. Calls `/api/goals/conversation` per turn.

### 11b. TaskCard component

Card showing: time slot, title, specific values, duration. Click to edit, delete button.

### 11c. PlanPreview component

Goal summary + task cards by day/week + "跟 AI 调整" button + "确认计划" button.

### 11d. Rewrite goal creation page

Step flow: Input → (Fast: loading → preview) or (Deep: chat → preview) → Confirm.

### Commit

```bash
git add app/goals/create/ components/
git commit -m "feat: new goal creation UI with chat + plan preview"
```

---

## Task 12: Goal Detail Page Updates

**Files:**
- Modify: `app/goals/[id]/page.tsx`

Add phase progress bar, countdown display, specific values on tasks, "跟 AI 调整" button, plan version history.

### Commit

```bash
git add app/goals/[id]/page.tsx
git commit -m "feat: update goal detail with phases, specific values, plan modification"
```

---

## Task 13: Plan Modification API

**Files:**
- Create: `app/api/goals/[id]/plan/modify/route.ts`
- Create: `app/api/goals/[id]/plan/edit/route.ts`

AI modification endpoint + direct edit endpoint. Both create PlanVersions.

### Commit

```bash
git add app/api/goals/[id]/plan/
git commit -m "feat: add plan modification API endpoints"
```

---

## Task 14: Weekly Review + Daily CheckIn Adaptation

**Files:**
- Modify: `lib/agents/weeklyReviewer.ts`
- Modify: `prompts/weekly_reviewer.md`
- Modify: `app/api/cron/daily-checkin/route.ts`
- Modify: `app/api/cron/weekly-review/route.ts`

Phase-aware weekly review, specific task details in daily emails, phase transitions.

### Commit

```bash
git add lib/agents/weeklyReviewer.ts prompts/ app/api/cron/
git commit -m "feat: adapt weekly review + daily checkin for phased plans"
```

---

## Task 15: Data Migration

**Files:**
- Create: `scripts/migrate-existing-data.ts`

Set defaults on existing goals (domain="general", complexity="simple"), create PlanVersion v1 for existing plans.

### Commit

```bash
git add scripts/
git commit -m "feat: add data migration script for existing goals"
```

---

## Dependency Graph

```
Task 1 (DB Schema) ──┬── Task 5 (Profile) ──┐
                      │                       │
Task 2 (Zod) ────────┼── Task 4 (Classifier) ├── Task 7 (Expert) ── Task 8 (PlanGen) ── Task 9 (Modifier)
                      │                       │                                │
Task 3 (Knowledge) ──┘                       │                                │
                                              └── Task 10 (Orchestrator) ─────┘
Task 6 (Validator) ──────────────────────────────────┘        │
                                                               │
                                              Task 11 (Frontend Create) ── Task 12 (Frontend Detail)
                                              Task 13 (Modify API)
                                              Task 14 (Review/CheckIn)
                                              Task 15 (Migration)
```

**Parallel groups:**
- Group A (no deps): Tasks 1, 2, 3 — can run in parallel
- Group B (after A): Tasks 4, 5, 6 — can run in parallel
- Group C (after B): Task 7
- Group D (after C): Task 8
- Group E (after D): Tasks 9, 10
- Group F (after E): Tasks 11, 12, 13, 14, 15 — mostly parallel
