/**
 * OneTimeToken utilities
 * Generate and validate tokens for email check-ins
 */

import { prisma } from "./prisma";
import { randomBytes } from "crypto";

const TOKEN_EXPIRY_HOURS = 24;

export type TokenPurpose = "checkin" | "weekly_review";

/**
 * Generate a secure random token
 */
function generateSecureToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Create a OneTimeToken for a goal
 */
export async function createOneTimeToken(
  goalId: string,
  purpose: TokenPurpose
): Promise<string> {
  const token = generateSecureToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

  await prisma.oneTimeToken.create({
    data: {
      goalId,
      purpose,
      token,
      expiresAt,
    },
  });

  return token;
}

/**
 * Validate and consume a token
 * Returns the token record if valid, null if invalid or expired
 */
export async function validateAndConsumeToken(token: string) {
  const tokenRecord = await prisma.oneTimeToken.findUnique({
    where: { token },
    include: {
      goal: {
        include: {
          user: true,
          tasks: {
            orderBy: { date: "asc" },
          },
        },
      },
    },
  });

  if (!tokenRecord) {
    return { valid: false, error: "Token not found" };
  }

  if (tokenRecord.usedAt) {
    return { valid: false, error: "Token already used" };
  }

  if (tokenRecord.expiresAt < new Date()) {
    return { valid: false, error: "Token expired" };
  }

  return { valid: true, tokenRecord };
}

/**
 * Mark a token as used
 */
export async function markTokenUsed(token: string): Promise<void> {
  await prisma.oneTimeToken.update({
    where: { token },
    data: { usedAt: new Date() },
  });
}

/**
 * Clean up expired tokens (can be called periodically)
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const result = await prisma.oneTimeToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { usedAt: { not: null } },
      ],
    },
  });
  return result.count;
}

/**
 * Get check-in URL for a token
 */
export function getCheckinUrl(token: string, baseUrl: string): string {
  return `${baseUrl}/checkin/${token}`;
}
