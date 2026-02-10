import { prisma } from "@/lib/prisma";
import { UserProfileData, UserProfileDataSchema } from "@/lib/schemas/userProfile";
import { DomainKnowledge } from "@/lib/knowledge/types";
import type { UserProfile, DomainProfile, Prisma } from "@prisma/client";

export interface OccupiedSlot {
  goalId: string;
  goalTitle: string;
  date: string;      // ISO date
  timeSlot: string;  // "07:00-08:00"
}

/**
 * Get an existing profile for the user, or create a new empty one.
 */
export async function getOrCreateProfile(userId: string): Promise<UserProfile> {
  const existing = await prisma.userProfile.findUnique({
    where: { userId },
  });

  if (existing) {
    return existing;
  }

  return prisma.userProfile.create({
    data: { userId },
  });
}

/**
 * Update the user's profile with partial data.
 * Validates input against UserProfileDataSchema before persisting.
 */
export async function updateProfile(
  userId: string,
  data: Partial<UserProfileData>
): Promise<UserProfile> {
  // Validate the incoming data — strip unknown fields via partial parse
  const parsed = UserProfileDataSchema.partial().parse(data);

  // Build the update payload, only including fields that were provided
  const updateData: Record<string, unknown> = {};
  if (parsed.wakeUpTime !== undefined) updateData.wakeUpTime = parsed.wakeUpTime;
  if (parsed.sleepTime !== undefined) updateData.sleepTime = parsed.sleepTime;
  if (parsed.workDays !== undefined) updateData.workDays = parsed.workDays;
  if (parsed.availableSlots !== undefined) updateData.availableSlots = parsed.availableSlots;
  if (parsed.timezone !== undefined) updateData.timezone = parsed.timezone;

  // Upsert: create if not exists, update if exists
  return prisma.userProfile.upsert({
    where: { userId },
    create: {
      userId,
      ...updateData,
    },
    update: updateData,
  });
}

/**
 * Get the domain-specific profile for a user (e.g. fitness stats, learning preferences).
 * Returns null if no domain profile exists yet.
 */
export async function getDomainProfile(
  userId: string,
  domain: string
): Promise<DomainProfile | null> {
  return prisma.domainProfile.findUnique({
    where: {
      userId_domain: { userId, domain },
    },
  });
}

/**
 * Create or update a domain-specific profile.
 * Merges the incoming data with any existing data in the domain profile.
 */
export async function updateDomainProfile(
  userId: string,
  domain: string,
  data: Record<string, unknown>
): Promise<DomainProfile> {
  const existing = await prisma.domainProfile.findUnique({
    where: {
      userId_domain: { userId, domain },
    },
  });

  const mergedData = existing
    ? { ...(existing.data as Record<string, unknown>), ...data }
    : data;

  return prisma.domainProfile.upsert({
    where: {
      userId_domain: { userId, domain },
    },
    create: {
      userId,
      domain,
      data: mergedData as Prisma.InputJsonValue,
    },
    update: {
      data: mergedData as Prisma.InputJsonValue,
    },
  });
}


/**
 * Determine which profile fields are still missing for a given domain.
 * Checks both the general UserProfile and the domain-specific DomainProfile
 * against the required profileQuestions defined in the DomainKnowledge.
 *
 * Returns an array of field names that still need to be filled in.
 */
export function getMissingProfileFields(
  profile: UserProfile | null,
  domainProfile: DomainProfile | null,
  domain: string,
  knowledge: DomainKnowledge
): string[] {
  const missing: string[] = [];

  // General profile fields that are commonly needed
  const generalFields = ["wakeUpTime", "sleepTime", "timezone"];
  if (profile) {
    for (const field of generalFields) {
      const value = (profile as Record<string, unknown>)[field];
      if (value === null || value === undefined || value === "") {
        missing.push(field);
      }
    }
  } else {
    // No profile at all — all general fields are missing
    missing.push(...generalFields);
  }

  // Domain-specific required fields from knowledge profileQuestions
  const domainData = (domainProfile?.data as Record<string, unknown>) ?? {};
  for (const question of knowledge.profileQuestions) {
    if (!question.required) continue;
    const value = domainData[question.field];
    if (value === null || value === undefined || value === "") {
      missing.push(question.field);
    }
  }

  return missing;
}

/**
 * Query all active goals' tasks to find occupied time slots.
 * Used for conflict detection when scheduling new tasks.
 * Optionally exclude a specific goal (e.g. the one being planned).
 */
export async function getOccupiedTimeSlots(
  userId: string,
  excludeGoalId?: string
): Promise<OccupiedSlot[]> {
  const whereClause: Record<string, unknown> = {
    goal: {
      userId,
      status: "active",
    },
    timeSlot: { not: null },
    status: { not: "missed" },
  };

  if (excludeGoalId) {
    whereClause.goalId = { not: excludeGoalId };
  }

  const tasks = await prisma.task.findMany({
    where: whereClause,
    select: {
      goalId: true,
      date: true,
      timeSlot: true,
      goal: {
        select: {
          title: true,
        },
      },
    },
    orderBy: { date: "asc" },
  });

  return tasks
    .filter((t): t is typeof t & { timeSlot: string } => t.timeSlot !== null)
    .map((task) => ({
      goalId: task.goalId,
      goalTitle: task.goal.title,
      date: task.date.toISOString().split("T")[0],
      timeSlot: task.timeSlot,
    }));
}