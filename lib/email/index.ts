/**
 * Email Service
 * High-level email functions for GoalFlow
 */

import { prisma } from "@/lib/prisma";
import { createOneTimeToken, getCheckinUrl } from "@/lib/tokens";
import { sendEmail, isEmailConfigured } from "./resend";
import { generateDailyCheckinEmail, generateWeeklyReviewEmail } from "./templates";

export { isEmailConfigured } from "./resend";

interface SendDailyCheckinResult {
  success: boolean;
  goalId: string;
  emailId?: string;
  error?: string;
}

/**
 * Send daily check-in email for a specific goal
 */
export async function sendDailyCheckinEmail(goalId: string): Promise<SendDailyCheckinResult> {
  if (!isEmailConfigured()) {
    return { success: false, goalId, error: "Email not configured" };
  }

  try {
    const goal = await prisma.goal.findUnique({
      where: { id: goalId },
      include: {
        user: true,
        tasks: {
          where: {
            date: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
              lt: new Date(new Date().setHours(23, 59, 59, 999)),
            },
          },
        },
        checkins: {
          orderBy: { date: "desc" },
          take: 30,
        },
      },
    });

    if (!goal || !goal.user?.email) {
      return { success: false, goalId, error: "Goal or user email not found" };
    }

    // Calculate streak
    let streak = 0;
    const checkins = goal.checkins.sort((a, b) => b.date.getTime() - a.date.getTime());
    let checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);
    checkDate.setDate(checkDate.getDate() - 1); // Start from yesterday

    for (const checkin of checkins) {
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

    // Generate token and URL
    const token = await createOneTimeToken(goalId, "checkin");
    const baseUrl = process.env.APP_URL || "http://localhost:3000";
    const checkinUrl = getCheckinUrl(token, baseUrl);

    // Prepare tasks data
    const todayTasks = goal.tasks.map((task) => {
      const taskJson = task.taskJson as any;
      return {
        title: taskJson.title,
        type: taskJson.type,
        duration_min: taskJson.duration_min,
      };
    });

    // Generate email
    const { html, text } = generateDailyCheckinEmail({
      userName: goal.user.name || "there",
      goalTitle: goal.title,
      checkinUrl,
      todayTasks,
      streak,
    });

    // Send email
    const result = await sendEmail({
      to: goal.user.email,
      subject: `📋 Daily Check-in: ${goal.title}`,
      html,
      text,
    });

    if (!result.success) {
      return { success: false, goalId, error: result.error };
    }

    // Log event
    await prisma.eventLog.create({
      data: {
        goalId,
        type: "email_sent",
        payloadJson: {
          emailType: "daily_checkin",
          emailId: result.id,
          sentAt: new Date().toISOString(),
        },
      },
    });

    return { success: true, goalId, emailId: result.id };
  } catch (error) {
    console.error("Send daily checkin email error:", error);
    return { success: false, goalId, error: (error as Error).message };
  }
}

/**
 * Send weekly review email for a specific goal
 */
export async function sendWeeklyReviewEmail(goalId: string): Promise<SendDailyCheckinResult> {
  if (!isEmailConfigured()) {
    return { success: false, goalId, error: "Email not configured" };
  }

  try {
    const goal = await prisma.goal.findUnique({
      where: { id: goalId },
      include: {
        user: true,
        checkins: {
          where: {
            date: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        },
      },
    });

    if (!goal || !goal.user?.email) {
      return { success: false, goalId, error: "Goal or user email not found" };
    }

    // Calculate week summary
    const checkins = goal.checkins;
    const doneCount = checkins.filter((c) => c.status === "done").length;
    const partialCount = checkins.filter((c) => c.status === "partial").length;
    const missedCount = checkins.filter((c) => c.status === "missed").length;
    const total = checkins.length || 7;
    const completionRate = (doneCount + partialCount * 0.5) / total;

    // Generate token and URL
    const token = await createOneTimeToken(goalId, "weekly_review");
    const baseUrl = process.env.APP_URL || "http://localhost:3000";
    const reviewUrl = `${baseUrl}/review/${token}`;

    // Generate email
    const { html, text } = generateWeeklyReviewEmail({
      userName: goal.user.name || "there",
      goalTitle: goal.title,
      reviewUrl,
      weekSummary: {
        completionRate,
        doneCount,
        partialCount,
        missedCount,
      },
    });

    // Send email
    const result = await sendEmail({
      to: goal.user.email,
      subject: `📊 Weekly Review: ${goal.title}`,
      html,
      text,
    });

    if (!result.success) {
      return { success: false, goalId, error: result.error };
    }

    // Log event
    await prisma.eventLog.create({
      data: {
        goalId,
        type: "email_sent",
        payloadJson: {
          emailType: "weekly_review",
          emailId: result.id,
          sentAt: new Date().toISOString(),
        },
      },
    });

    return { success: true, goalId, emailId: result.id };
  } catch (error) {
    console.error("Send weekly review email error:", error);
    return { success: false, goalId, error: (error as Error).message };
  }
}

/**
 * Helper: delay for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send daily check-in emails to all active goals
 * Rate limited to avoid Resend's 2 requests/second limit
 */
export async function sendAllDailyCheckinEmails(): Promise<{
  total: number;
  success: number;
  failed: number;
  results: SendDailyCheckinResult[];
}> {
  const activeGoals = await prisma.goal.findMany({
    where: { status: "active" },
    select: { id: true },
  });

  const results: SendDailyCheckinResult[] = [];

  for (let i = 0; i < activeGoals.length; i++) {
    const goal = activeGoals[i];
    const result = await sendDailyCheckinEmail(goal.id);
    results.push(result);

    // Rate limit: wait 600ms between emails (max ~1.6 emails/sec, under 2/sec limit)
    if (i < activeGoals.length - 1) {
      await delay(600);
    }
  }

  return {
    total: results.length,
    success: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

/**
 * Send weekly review emails to all active goals
 * Rate limited to avoid Resend's 2 requests/second limit
 */
export async function sendAllWeeklyReviewEmails(): Promise<{
  total: number;
  success: number;
  failed: number;
  results: SendDailyCheckinResult[];
}> {
  const activeGoals = await prisma.goal.findMany({
    where: { status: "active" },
    select: { id: true },
  });

  const results: SendDailyCheckinResult[] = [];

  for (let i = 0; i < activeGoals.length; i++) {
    const goal = activeGoals[i];
    const result = await sendWeeklyReviewEmail(goal.id);
    results.push(result);

    // Rate limit: wait 600ms between emails (max ~1.6 emails/sec, under 2/sec limit)
    if (i < activeGoals.length - 1) {
      await delay(600);
    }
  }

  return {
    total: results.length,
    success: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}
