/**
 * Badge Service
 * Handles badge detection and awarding
 */

import { prisma } from "./prisma";

export type BadgeType =
  | "first_checkin"
  | "streak_3"
  | "streak_7"
  | "streak_14"
  | "streak_30"
  | "first_weekly_review"
  | "goal_completed"
  | "perfect_week";

interface BadgeDefinition {
  type: BadgeType;
  title: string;
  description: string;
  icon: string;
}

export const BADGE_DEFINITIONS: Record<BadgeType, BadgeDefinition> = {
  first_checkin: {
    type: "first_checkin",
    title: "First Steps",
    description: "Completed your first check-in",
    icon: "🎯",
  },
  streak_3: {
    type: "streak_3",
    title: "Getting Started",
    description: "3-day streak achieved",
    icon: "🔥",
  },
  streak_7: {
    type: "streak_7",
    title: "Week Warrior",
    description: "7-day streak achieved",
    icon: "💪",
  },
  streak_14: {
    type: "streak_14",
    title: "Dedicated",
    description: "14-day streak achieved",
    icon: "⭐",
  },
  streak_30: {
    type: "streak_30",
    title: "Unstoppable",
    description: "30-day streak achieved",
    icon: "🏆",
  },
  first_weekly_review: {
    type: "first_weekly_review",
    title: "Reflector",
    description: "Completed your first weekly review",
    icon: "📊",
  },
  goal_completed: {
    type: "goal_completed",
    title: "Goal Crusher",
    description: "Completed a goal",
    icon: "🎉",
  },
  perfect_week: {
    type: "perfect_week",
    title: "Perfect Week",
    description: "Completed all tasks for a week",
    icon: "✨",
  },
};

/**
 * Award a badge to a user for a goal
 * Returns true if badge was newly awarded, false if already had it
 */
export async function awardBadge(
  userId: string,
  goalId: string,
  badgeType: BadgeType
): Promise<{ awarded: boolean; badge?: BadgeDefinition }> {
  try {
    // Check if user already has this badge for this goal
    const existing = await prisma.badge.findUnique({
      where: {
        userId_goalId_badgeType: {
          userId,
          goalId,
          badgeType,
        },
      },
    });

    if (existing) {
      return { awarded: false };
    }

    // Award the badge
    await prisma.badge.create({
      data: {
        userId,
        goalId,
        badgeType,
      },
    });

    // Log event
    await prisma.eventLog.create({
      data: {
        goalId,
        type: "badge_earned",
        payloadJson: {
          badgeType,
          ...BADGE_DEFINITIONS[badgeType],
        },
      },
    });

    return { awarded: true, badge: BADGE_DEFINITIONS[badgeType] };
  } catch (error) {
    console.error("Award badge error:", error);
    return { awarded: false };
  }
}

/**
 * Check and award badges after a check-in
 */
export async function checkAndAwardCheckinBadges(
  userId: string,
  goalId: string
): Promise<BadgeDefinition[]> {
  const awarded: BadgeDefinition[] = [];

  // Get all checkins for this goal
  const checkins = await prisma.checkin.findMany({
    where: { goalId },
    orderBy: { date: "desc" },
  });

  const completedCheckins = checkins.filter(
    (c) => c.status === "done" || c.status === "partial"
  );

  // First check-in badge
  if (completedCheckins.length === 1) {
    const result = await awardBadge(userId, goalId, "first_checkin");
    if (result.awarded && result.badge) {
      awarded.push(result.badge);
    }
  }

  // Calculate current streak
  let streak = 0;
  let checkDate = new Date();
  checkDate.setHours(0, 0, 0, 0);

  const sortedCheckins = [...checkins].sort(
    (a, b) => b.date.getTime() - a.date.getTime()
  );

  for (const checkin of sortedCheckins) {
    const checkinDate = new Date(checkin.date);
    checkinDate.setHours(0, 0, 0, 0);

    if (checkinDate.getTime() === checkDate.getTime()) {
      if (checkin.status === "done" || checkin.status === "partial") {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    } else if (checkinDate.getTime() < checkDate.getTime()) {
      break;
    }
  }

  // Streak badges
  const streakBadges: { threshold: number; type: BadgeType }[] = [
    { threshold: 3, type: "streak_3" },
    { threshold: 7, type: "streak_7" },
    { threshold: 14, type: "streak_14" },
    { threshold: 30, type: "streak_30" },
  ];

  for (const { threshold, type } of streakBadges) {
    if (streak >= threshold) {
      const result = await awardBadge(userId, goalId, type);
      if (result.awarded && result.badge) {
        awarded.push(result.badge);
      }
    }
  }

  // Perfect week badge - check if last 7 days all have "done" status
  if (checkins.length >= 7) {
    const lastWeekCheckins = checkins.slice(0, 7);
    const allDone = lastWeekCheckins.every((c) => c.status === "done");
    if (allDone) {
      const result = await awardBadge(userId, goalId, "perfect_week");
      if (result.awarded && result.badge) {
        awarded.push(result.badge);
      }
    }
  }

  return awarded;
}

/**
 * Check and award badges after a weekly review
 */
export async function checkAndAwardWeeklyReviewBadges(
  userId: string,
  goalId: string
): Promise<BadgeDefinition[]> {
  const awarded: BadgeDefinition[] = [];

  // Count weekly reviews for this goal
  const reviewCount = await prisma.weeklyReview.count({
    where: {
      goalId,
      chosenOption: { not: null },
    },
  });

  // First weekly review badge
  if (reviewCount === 1) {
    const result = await awardBadge(userId, goalId, "first_weekly_review");
    if (result.awarded && result.badge) {
      awarded.push(result.badge);
    }
  }

  return awarded;
}

/**
 * Get all badges for a user
 */
export async function getUserBadges(userId: string) {
  const badges = await prisma.badge.findMany({
    where: { userId },
    include: { goal: { select: { title: true } } },
    orderBy: { earnedAt: "desc" },
  });

  return badges.map((badge) => ({
    ...badge,
    ...BADGE_DEFINITIONS[badge.badgeType as BadgeType],
  }));
}

/**
 * Get badges for a specific goal
 */
export async function getGoalBadges(goalId: string) {
  const badges = await prisma.badge.findMany({
    where: { goalId },
    orderBy: { earnedAt: "desc" },
  });

  return badges.map((badge) => ({
    ...badge,
    ...BADGE_DEFINITIONS[badge.badgeType as BadgeType],
  }));
}
