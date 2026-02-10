/**
 * Weekly Review Cron API (Phase-Aware)
 * GET /api/cron/weekly-review - Send weekly review emails to goals that have completed a week
 *
 * Phase-aware enhancements:
 * - Passes phase information to the weekly reviewer
 * - Handles phase transitions after review
 * - Updates Plan.currentWeek after each weekly review
 * - Generates next week's tasks if needed (for phased plans that generate week-by-week)
 *
 * Call this endpoint from a cron service (Vercel Cron, GitHub Actions, etc.)
 * Recommended: Weekly on Sunday evening or Monday morning
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendWeeklyReviewEmail, isEmailConfigured } from "@/lib/email";
import {
  extractPhaseInfo,
  shouldTransitionPhase,
} from "@/lib/agents/weeklyReviewer";
import { Phase } from "@/lib/schemas/plan";

// Verify cron secret
function verifyCronSecret(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Advance the plan's currentWeek and handle phase transitions
 */
async function advancePlanWeek(planId: string): Promise<{
  newWeek: number;
  phaseTransitioned: boolean;
  newPhase?: number;
}> {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) {
    console.warn(`[WeeklyReview] Plan ${planId} not found for week advancement`);
    return { newWeek: 0, phaseTransitioned: false };
  }

  const currentWeek = plan.currentWeek ?? 0;
  const currentPhase = plan.currentPhase ?? 0;
  const newWeek = currentWeek + 1;

  // Check if phase transition is needed
  const phases = plan.phases as Phase[] | null;
  let phaseTransitioned = false;
  let newPhase = currentPhase;

  if (phases && phases.length > 0) {
    // Calculate weeks elapsed in current phase
    const phaseStartWeek = phases
      .slice(0, currentPhase)
      .reduce((sum: number, p: Phase) => sum + (p.durationWeeks || 1), 0);
    const weeksInPhase = newWeek - phaseStartWeek;
    const currentPhaseObj = phases[currentPhase];

    if (currentPhaseObj && weeksInPhase >= currentPhaseObj.durationWeeks) {
      // Phase duration completed — transition to next phase
      if (currentPhase < phases.length - 1) {
        newPhase = currentPhase + 1;
        phaseTransitioned = true;
        console.log(
          `[WeeklyReview] Phase transition: "${currentPhaseObj.name}" -> "${phases[newPhase].name}" (phase ${newPhase + 1}/${phases.length})`
        );
      } else {
        console.log(
          `[WeeklyReview] Final phase "${currentPhaseObj.name}" completed. Plan may be finishing.`
        );
      }
    }
  }

  // Update the plan record
  await prisma.plan.update({
    where: { id: planId },
    data: {
      currentWeek: newWeek,
      ...(phaseTransitioned ? { currentPhase: newPhase } : {}),
    },
  });

  console.log(
    `[WeeklyReview] Plan ${planId} advanced to week ${newWeek}${phaseTransitioned ? `, phase ${newPhase}` : ""}`
  );

  return { newWeek, phaseTransitioned, newPhase: phaseTransitioned ? newPhase : undefined };
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    // Find active goals that:
    // 1. Were created at least 7 days ago
    // 2. Don't have a pending weekly review (chosenOption is null)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const goalsNeedingReview = await prisma.goal.findMany({
      where: {
        status: "active",
        createdAt: {
          lte: sevenDaysAgo,
        },
      },
      include: {
        weeklyReviews: {
          orderBy: { weekIndex: "desc" },
          take: 1,
        },
        plans: {
          where: { status: "active" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    const results: {
      goalId: string;
      success: boolean;
      error?: string;
      weekAdvanced?: boolean;
      phaseTransitioned?: boolean;
    }[] = [];

    // Helper: delay for rate limiting
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const goalsToReview: Array<{ goalId: string; planId?: string }> = [];

    for (const goal of goalsNeedingReview) {
      // Check if last review was more than 7 days ago
      const lastReview = goal.weeklyReviews[0];
      const lastPlan = goal.plans[0];

      let needsReview = false;

      if (!lastReview) {
        // Never had a review, check if plan is at least 7 days old
        if (lastPlan && lastPlan.createdAt <= sevenDaysAgo) {
          needsReview = true;
        }
      } else {
        // Has previous review, check if it was chosen and more than 7 days ago
        const reviewDate = lastReview.createdAt;
        if (lastReview.chosenOption !== null && reviewDate <= sevenDaysAgo) {
          needsReview = true;
        }
      }

      if (needsReview) {
        goalsToReview.push({
          goalId: goal.id,
          planId: lastPlan?.id,
        });
      }
    }

    console.log(
      `[WeeklyReview] Found ${goalsToReview.length} goals needing review out of ${goalsNeedingReview.length} checked`
    );

    // Send emails and advance weeks with rate limiting (600ms between emails)
    for (let i = 0; i < goalsToReview.length; i++) {
      const { goalId, planId } = goalsToReview[i];

      try {
        // Send the weekly review email
        const emailResult = await sendWeeklyReviewEmail(goalId);

        if (!emailResult.success) {
          results.push({
            goalId,
            success: false,
            error: emailResult.error,
          });
          continue;
        }

        // Advance the plan's currentWeek and handle phase transitions
        let weekAdvanced = false;
        let phaseTransitioned = false;

        if (planId) {
          const advancement = await advancePlanWeek(planId);
          weekAdvanced = true;
          phaseTransitioned = advancement.phaseTransitioned;

          // Log the phase transition event
          if (phaseTransitioned) {
            const plan = await prisma.plan.findUnique({ where: { id: planId } });
            const phases = plan?.phases as Phase[] | null;
            const newPhaseObj = phases && advancement.newPhase !== undefined
              ? phases[advancement.newPhase]
              : null;

            await prisma.eventLog.create({
              data: {
                goalId,
                type: "phase_transition",
                payloadJson: {
                  planId,
                  fromPhase: (plan?.currentPhase ?? 0) - 1,
                  toPhase: advancement.newPhase,
                  newPhaseName: newPhaseObj?.name ?? "Unknown",
                  newWeek: advancement.newWeek,
                  transitionedAt: new Date().toISOString(),
                },
              },
            });

            console.log(
              `[WeeklyReview] Phase transition logged for goal ${goalId}: phase ${advancement.newPhase}`
            );
          }
        }

        results.push({
          goalId,
          success: true,
          weekAdvanced,
          phaseTransitioned,
        });

        console.log(
          `[WeeklyReview] Processed goal ${goalId}: email sent${weekAdvanced ? ", week advanced" : ""}${phaseTransitioned ? ", phase transitioned" : ""}`
        );
      } catch (error) {
        console.error(`[WeeklyReview] Error processing goal ${goalId}:`, error);
        results.push({
          goalId,
          success: false,
          error: (error as Error).message,
        });
      }

      // Rate limit: wait 600ms between emails
      if (i < goalsToReview.length - 1) {
        await delay(600);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;
    const transitionCount = results.filter((r) => r.phaseTransitioned).length;

    console.log(
      `[WeeklyReview] Completed: ${successCount} sent, ${failedCount} failed, ${transitionCount} phase transitions`
    );

    return NextResponse.json({
      success: true,
      summary: {
        checked: goalsNeedingReview.length,
        emailsSent: successCount,
        failed: failedCount,
        phaseTransitions: transitionCount,
      },
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[WeeklyReview] Cron error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
