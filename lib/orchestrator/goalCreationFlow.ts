/**
 * Goal Creation Orchestrator
 * Coordinates all agents through fast-path and deep-path goal creation flows.
 */

import { prisma } from "@/lib/prisma";
import { classifyGoal, preClassify } from "@/lib/agents/goalClassifier";
import {
  startExpertConversation,
  continueExpertConversation,
} from "@/lib/agents/domainExpert";
import {
  generatePlan,
  generateSimplePlan,
} from "@/lib/agents/planGenerator";
import {
  getOrCreateProfile,
  getDomainProfile,
  updateDomainProfile,
  getOccupiedTimeSlots,
} from "@/lib/profile/profileManager";
import { Classification } from "@/lib/schemas/classification";
import { GoalSpec } from "@/lib/schemas/goalSpec";
import { ExpertTurnResult } from "@/lib/schemas/conversation";
import { Plan } from "@/lib/schemas/plan";
import { ConstraintViolation } from "@/lib/validators/constraintValidator";
import { UserProfileData } from "@/lib/schemas/userProfile";
import type { UserProfile, DomainProfile } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUserProfileData(profile: UserProfile): UserProfileData {
  return {
    wakeUpTime: profile.wakeUpTime ?? undefined,
    sleepTime: profile.sleepTime ?? undefined,
    workDays: (profile.workDays as number[]) ?? undefined,
    availableSlots: (profile.availableSlots as any[]) ?? undefined,
    timezone: profile.timezone ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Fast Path — simple goals, no conversation needed
// ---------------------------------------------------------------------------

/**
 * Create a goal via the fast path: classify, generate a simple plan,
 * persist everything, and return the result.
 */
export async function createGoalFastPath(
  userId: string,
  title: string,
  category?: string,
): Promise<{
  goalId: string;
  plan: Plan;
  classification: Classification;
  goalSpec: GoalSpec;
  violations: ConstraintViolation[];
}> {
  console.log(`[Orchestrator] createGoalFastPath for user=${userId}, title="${title}"`);

  // 1. Get or create user profile
  const profile = await getOrCreateProfile(userId);
  const userProfile = buildUserProfileData(profile);

  // 2. Get occupied time slots
  const occupiedSlots = await getOccupiedTimeSlots(userId);

  // 3. Generate simple plan (includes classification + goalSpec creation)
  const { plan, classification, goalSpec } = await generateSimplePlan({
    title,
    userProfile,
    occupiedSlots,
  });

  // Override category if provided
  if (category) {
    goalSpec.category = category;
  }

  console.log(`[Orchestrator] Fast path plan generated: ${plan.weeks.length} week(s)`);

  // 4. Create Goal in DB
  const goal = await prisma.goal.create({
    data: {
      userId,
      title: goalSpec.title,
      category: goalSpec.category || category || "general",
      goalSpecJson: goalSpec as any,
      domain: classification.domain,
      complexity: classification.complexity,
      planStructure: classification.planStructure,
      status: "active",
    },
  });

  // 5. Create Plan in DB
  const startDate = plan.start_date || new Date().toISOString().split("T")[0];
  const planRecord = await prisma.plan.create({
    data: {
      goalId: goal.id,
      startDate: new Date(startDate),
      planJson: plan as any,
      version: plan.version,
      status: "active",
      promptVersion: "v2.0.0",
      phases: plan.phases ? (plan.phases as any) : undefined,
      totalDuration: plan.totalDurationDays ?? undefined,
    },
  });

  // 6. Create Task records for ALL weeks
  for (const week of plan.weeks) {
    for (const day of week.days) {
      for (const task of day.tasks) {
        await prisma.task.create({
          data: {
            goalId: goal.id,
            planId: planRecord.id,
            date: new Date(day.date),
            dayIndex: day.day_index,
            taskJson: task as any,
            status: "pending",
            timeSlot: task.timeSlot ?? null,
          },
        });
      }
    }
  }

  // 7. Create PlanVersion v1
  await prisma.planVersion.create({
    data: {
      planId: planRecord.id,
      version: 1,
      content: plan as any,
      changeSource: "fast_path_creation",
      changeSummary: "Initial plan created via fast path",
    },
  });

  // 8. Log event
  await prisma.eventLog.create({
    data: {
      goalId: goal.id,
      type: "goal_created",
      payloadJson: {
        path: "fast",
        classification,
        goalSpec,
        planGenerated: true,
      } as any,
    },
  });

  console.log(`[Orchestrator] Fast path complete: goalId=${goal.id}`);

  return {
    goalId: goal.id,
    plan,
    classification,
    goalSpec,
    violations: [],
  };
}

// ---------------------------------------------------------------------------
// Deep Path — complex goals, expert conversation needed
// ---------------------------------------------------------------------------

/**
 * Start the deep path: classify the goal and begin an expert conversation
 * to gather detailed information before plan generation.
 */
export async function startDeepPath(
  userId: string,
  title: string,
  classification: Classification,
): Promise<{
  conversationId: string;
  firstTurn: ExpertTurnResult;
}> {
  console.log(
    `[Orchestrator] startDeepPath for user=${userId}, domain=${classification.domain}`,
  );

  // 1. Get or create user profile
  const profile = await getOrCreateProfile(userId);

  // 2. Get domain profile for the classified domain
  const domainProfile = await getDomainProfile(userId, classification.domain);

  // 3. Get active goals for conflict awareness
  const activeGoals = await prisma.goal.findMany({
    where: { userId, status: "active" },
    select: { id: true, title: true, category: true, domain: true },
  });

  // 4. Start expert conversation
  const { conversationId, firstTurn } = await startExpertConversation(
    title,
    classification,
    profile,
    domainProfile,
    activeGoals,
  );

  console.log(
    `[Orchestrator] Deep path started: conversationId=${conversationId}`,
  );

  return { conversationId, firstTurn };
}

/**
 * Continue an ongoing expert conversation with a user message.
 * If the expert returns profile updates, persist them.
 */
export async function continueDeepPath(
  conversationId: string,
  userMessage: string,
): Promise<ExpertTurnResult> {
  console.log(
    `[Orchestrator] continueDeepPath: conversationId=${conversationId}`,
  );

  // 1. Continue the expert conversation
  const result = await continueExpertConversation(conversationId, userMessage);

  // 2. If profileUpdates returned, persist them
  if (result.profileUpdates && Object.keys(result.profileUpdates).length > 0) {
    // Look up the conversation to get domain and userId
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (conversation) {
      const state = conversation.messages as any;
      const domain = state?.domain;

      // We need the userId — get it from the conversation's goal or from the state
      // Since conversations may not have a goalId yet, we look at the conversation
      // to find the user. The conversation doesn't store userId directly,
      // so we need to find it through the goal or infer from context.
      // For now, if there's a goalId, use that; otherwise check state.
      let userId: string | null = null;

      if (conversation.goalId) {
        const goal = await prisma.goal.findUnique({
          where: { id: conversation.goalId },
          select: { userId: true },
        });
        userId = goal?.userId ?? null;
      }

      if (userId && domain) {
        console.log(
          `[Orchestrator] Saving profile updates for domain=${domain}`,
        );
        await updateDomainProfile(userId, domain, result.profileUpdates);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Finalize Plan — create goal + plan from completed expert conversation
// ---------------------------------------------------------------------------

/**
 * Finalize a goal after the expert conversation is complete.
 * Takes the GoalSpec and Classification, generates a full plan,
 * and persists everything to the database.
 */
export async function finalizePlan(
  userId: string,
  goalSpec: GoalSpec,
  classification: Classification,
  conversationId?: string,
): Promise<{
  goalId: string;
  plan: Plan;
  violations: ConstraintViolation[];
}> {
  console.log(
    `[Orchestrator] finalizePlan for user=${userId}, goal="${goalSpec.title}"`,
  );

  // 1. Get user profile and build UserProfileData
  const profile = await getOrCreateProfile(userId);
  const userProfile = buildUserProfileData(profile);

  // 2. Get domain profile
  const domainProfile = await getDomainProfile(userId, classification.domain);

  // 3. Get occupied time slots
  const occupiedSlots = await getOccupiedTimeSlots(userId);

  // 4. Generate full plan
  const { plan, violations } = await generatePlan({
    goalSpec,
    classification,
    userProfile,
    domainProfile,
    occupiedSlots,
  });

  console.log(
    `[Orchestrator] Plan generated: ${plan.weeks.length} week(s), ` +
      `${violations.length} violation(s)`,
  );

  // 5. Create Goal in DB with all classification data
  const goal = await prisma.goal.create({
    data: {
      userId,
      title: goalSpec.title,
      category: goalSpec.category || classification.domain || "general",
      goalSpecJson: goalSpec as any,
      domain: classification.domain,
      complexity: classification.complexity,
      planStructure: classification.planStructure,
      constraints: goalSpec.structuredConstraints
        ? (goalSpec.structuredConstraints as any)
        : undefined,
      status: "active",
    },
  });

  // 6. Create Plan in DB
  const startDate = plan.start_date || new Date().toISOString().split("T")[0];
  const planRecord = await prisma.plan.create({
    data: {
      goalId: goal.id,
      startDate: new Date(startDate),
      planJson: plan as any,
      version: plan.version,
      status: "active",
      promptVersion: "v2.0.0",
      phases: plan.phases ? (plan.phases as any) : undefined,
      totalDuration: plan.totalDurationDays ?? undefined,
    },
  });

  // 7. Create Task records for ALL weeks
  for (const week of plan.weeks) {
    for (const day of week.days) {
      for (const task of day.tasks) {
        await prisma.task.create({
          data: {
            goalId: goal.id,
            planId: planRecord.id,
            date: new Date(day.date),
            dayIndex: day.day_index,
            taskJson: task as any,
            status: "pending",
            timeSlot: task.timeSlot ?? null,
          },
        });
      }
    }
  }

  // 8. Create PlanVersion v1
  await prisma.planVersion.create({
    data: {
      planId: planRecord.id,
      version: 1,
      content: plan as any,
      changeSource: "deep_path_creation",
      changeSummary: "Initial plan created via deep path with expert conversation",
    },
  });

  // 9. If conversationId, link it to the goal
  if (conversationId) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { goalId: goal.id },
    });
  }

  // 10. Log event
  await prisma.eventLog.create({
    data: {
      goalId: goal.id,
      type: "goal_created",
      payloadJson: {
        path: "deep",
        classification,
        goalSpec,
        conversationId: conversationId ?? null,
        planGenerated: true,
        violationCount: violations.length,
      } as any,
    },
  });

  console.log(
    `[Orchestrator] Finalize complete: goalId=${goal.id}, planId=${planRecord.id}`,
  );

  return {
    goalId: goal.id,
    plan,
    violations,
  };
}
