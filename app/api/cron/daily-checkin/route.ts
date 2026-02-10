/**
 * Daily Check-in Cron API (Phase-Aware)
 * GET /api/cron/daily-checkin - Send daily check-in emails to all active goals
 *
 * Phase-aware enhancements:
 * - Includes specific task values in check-in emails (e.g., "Run 3km at 7:00 AM")
 * - Includes time slot information
 * - Shows phase progress
 * - Handles multi-week plans (finds today's tasks across all weeks, not just week[0])
 *
 * Call this endpoint from a cron service (Vercel Cron, GitHub Actions, etc.)
 * Recommended: Daily at 9:00 AM in your target timezone
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createOneTimeToken, getCheckinUrl } from "@/lib/tokens";
import { sendEmail, isEmailConfigured } from "@/lib/email/resend";
import { generateDailyCheckinEmail } from "@/lib/email/templates";
import { extractPhaseInfo } from "@/lib/agents/weeklyReviewer";

// Verify cron secret to prevent unauthorized access
function verifyCronSecret(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // If no secret is configured, allow (for development)
  if (!cronSecret) return true;

  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Build a rich task description including specificValues and timeSlot
 */
function formatTaskForEmail(taskJson: any): {
  title: string;
  type: string;
  duration_min: number;
  specificValues?: Record<string, any>;
  timeSlot?: string;
} {
  const base = {
    title: taskJson.title || "Untitled Task",
    type: taskJson.type || "habit",
    duration_min: taskJson.duration_min || 0,
  };

  // Enrich title with specific values and time slot
  const parts: string[] = [];

  if (taskJson.specificValues && Object.keys(taskJson.specificValues).length > 0) {
    const specParts = Object.entries(taskJson.specificValues)
      .map(([key, val]) => `${val}`)
      .join(", ");
    parts.push(specParts);
  }

  if (taskJson.timeSlot) {
    parts.push(`at ${taskJson.timeSlot}`);
  }

  const enrichedTitle = parts.length > 0
    ? `${base.title} (${parts.join(" ")})`
    : base.title;

  return {
    ...base,
    title: enrichedTitle,
    specificValues: taskJson.specificValues,
    timeSlot: taskJson.timeSlot,
  };
}

export async function GET(req: NextRequest) {
  // Verify authorization
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if email is configured
  if (!isEmailConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error: "Email not configured. Set RESEND_API_KEY environment variable.",
      },
      { status: 503 }
    );
  }

  try {
    const today = new Date();
    const todayStart = new Date(today.setHours(0, 0, 0, 0));
    const todayEnd = new Date(new Date().setHours(23, 59, 59, 999));

    // Find all active goals with their plans, tasks, and checkins
    const activeGoals = await prisma.goal.findMany({
      where: { status: "active" },
      include: {
        user: true,
        plans: {
          where: { status: "active" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        tasks: {
          where: {
            date: {
              gte: todayStart,
              lt: todayEnd,
            },
          },
        },
        checkins: {
          orderBy: { date: "desc" },
          take: 30,
        },
      },
    });

    const results: { goalId: string; success: boolean; error?: string }[] = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let i = 0; i < activeGoals.length; i++) {
      const goal = activeGoals[i];

      if (!goal.user?.email) {
        results.push({ goalId: goal.id, success: false, error: "No user email" });
        continue;
      }

      try {
        // Calculate streak
        let streak = 0;
        const checkins = goal.checkins.sort((a, b) => b.date.getTime() - a.date.getTime());
        let checkDate = new Date();
        checkDate.setHours(0, 0, 0, 0);
        checkDate.setDate(checkDate.getDate() - 1);

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

        // Get phase info from active plan
        const activePlan = goal.plans[0];
        const phaseInfo = activePlan ? extractPhaseInfo(activePlan) : null;

        // Prepare tasks with specific values and time slots
        const todayTasks = goal.tasks.map((task) => {
          const taskJson = task.taskJson as any;
          return formatTaskForEmail(taskJson);
        });

        // Generate token and URL
        const token = await createOneTimeToken(goal.id, "checkin");
        const baseUrl = process.env.APP_URL || "http://localhost:3000";
        const checkinUrl = getCheckinUrl(token, baseUrl);

        // Build phase progress string for email
        let phaseProgress = "";
        if (phaseInfo) {
          phaseProgress = `Phase ${phaseInfo.currentPhase + 1}/${phaseInfo.totalPhases}: ${phaseInfo.phaseName} — Week ${phaseInfo.weekWithinPhase + 1} of ${phaseInfo.phaseWeeksTotal}`;
        }

        // Generate email with enriched task data
        const { html, text } = generateDailyCheckinEmail({
          userName: goal.user.name || "there",
          goalTitle: goal.title,
          checkinUrl,
          todayTasks,
          streak,
          phaseProgress: phaseProgress || undefined,
        });

        // Send email
        const emailResult = await sendEmail({
          to: goal.user.email,
          subject: `Daily Check-in: ${goal.title}`,
          html,
          text,
        });

        if (!emailResult.success) {
          results.push({ goalId: goal.id, success: false, error: emailResult.error });
          continue;
        }

        // Log event
        await prisma.eventLog.create({
          data: {
            goalId: goal.id,
            type: "email_sent",
            payloadJson: {
              emailType: "daily_checkin",
              emailId: emailResult.id,
              phaseInfo: phaseInfo ? {
                phase: phaseInfo.currentPhase,
                phaseName: phaseInfo.phaseName,
                weekWithinPhase: phaseInfo.weekWithinPhase,
              } : null,
              taskCount: todayTasks.length,
              sentAt: new Date().toISOString(),
            },
          },
        });

        console.log(`[DailyCheckin] Sent email for goal ${goal.id}${phaseInfo ? ` (${phaseInfo.phaseName}, week ${phaseInfo.weekWithinPhase + 1})` : ""}, ${todayTasks.length} tasks`);
        results.push({ goalId: goal.id, success: true });
      } catch (error) {
        console.error(`[DailyCheckin] Error for goal ${goal.id}:`, error);
        results.push({ goalId: goal.id, success: false, error: (error as Error).message });
      }

      // Rate limit: wait 600ms between emails
      if (i < activeGoals.length - 1) {
        await delay(600);
      }
    }

    console.log(`[DailyCheckin] Completed: ${results.filter((r) => r.success).length}/${results.length} emails sent`);

    return NextResponse.json({
      success: true,
      summary: {
        total: results.length,
        success: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
      },
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[DailyCheckin] Cron error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Also allow POST for some cron services
export async function POST(req: NextRequest) {
  return GET(req);
}
