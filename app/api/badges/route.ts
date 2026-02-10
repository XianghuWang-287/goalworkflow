/**
 * Badges API
 * GET /api/badges - Get all badges for current user
 * GET /api/badges?goalId=xxx - Get badges for a specific goal
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserBadges, getGoalBadges, BADGE_DEFINITIONS } from "@/lib/badges";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const goalId = searchParams.get("goalId");

    if (goalId) {
      // Get badges for specific goal
      const badges = await getGoalBadges(goalId);
      return NextResponse.json({ badges });
    } else {
      // Get all badges for user
      const badges = await getUserBadges(session.user.id);
      return NextResponse.json({ badges });
    }
  } catch (error) {
    console.error("Get badges error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET /api/badges/definitions - Get all badge definitions
export async function OPTIONS() {
  return NextResponse.json({ definitions: BADGE_DEFINITIONS });
}
