/**
 * Token Generation API
 * POST /api/tokens - Generate a OneTimeToken (internal use for email system)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createOneTimeToken, TokenPurpose } from "@/lib/tokens";
import { z } from "zod";

const CreateTokenSchema = z.object({
  goalId: z.string(),
  purpose: z.enum(["checkin", "weekly_review"]),
});

// Internal API key check (for cron jobs or internal services)
function validateInternalApiKey(req: NextRequest): boolean {
  const apiKey = req.headers.get("x-internal-api-key");
  const expectedKey = process.env.INTERNAL_API_KEY;

  // If no internal key is configured, allow (for development)
  if (!expectedKey) return true;

  return apiKey === expectedKey;
}

export async function POST(req: NextRequest) {
  try {
    // Validate internal API key
    if (!validateInternalApiKey(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = CreateTokenSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { goalId, purpose } = parsed.data;

    // Verify goal exists
    const goal = await prisma.goal.findUnique({
      where: { id: goalId },
      include: { user: true },
    });

    if (!goal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    const token = await createOneTimeToken(goalId, purpose as TokenPurpose);
    const baseUrl = process.env.APP_URL || "http://localhost:3000";
    const checkinUrl = `${baseUrl}/checkin/${token}`;

    return NextResponse.json({
      success: true,
      token,
      url: checkinUrl,
      expiresIn: "24 hours",
    });
  } catch (error) {
    console.error("Token generation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
