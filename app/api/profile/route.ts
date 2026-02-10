import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getOrCreateProfile,
  updateProfile,
  getDomainProfile,
  updateDomainProfile,
} from "@/lib/profile/profileManager";
import { UserProfileDataSchema } from "@/lib/schemas/userProfile";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/profile
 * Returns the user's general profile and all domain profiles.
 * Query param ?domain=fitness can be used to fetch a single domain profile.
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { searchParams } = new URL(request.url);
    const domain = searchParams.get("domain");

    const profile = await getOrCreateProfile(userId);

    if (domain) {
      const domainProfile = await getDomainProfile(userId, domain);
      return NextResponse.json({ profile, domainProfile });
    }

    // Return all domain profiles
    const domainProfiles = await prisma.domainProfile.findMany({
      where: { userId },
    });

    return NextResponse.json({ profile, domainProfiles });
  } catch (error) {
    console.error("Get profile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/profile
 * Update the user's general profile and/or a domain profile.
 * Body: { profile?: Partial<UserProfileData>, domain?: string, domainData?: Record<string, unknown> }
 */
export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();
    const { profile: profileData, domain, domainData } = body;

    let updatedProfile = null;
    let updatedDomainProfile = null;

    // Update general profile if data provided
    if (profileData && typeof profileData === "object") {
      const parsed = UserProfileDataSchema.partial().safeParse(profileData);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid profile data", details: parsed.error.flatten() },
          { status: 400 }
        );
      }
      updatedProfile = await updateProfile(userId, parsed.data);
    }

    // Update domain profile if domain and data provided
    if (domain && typeof domain === "string" && domainData && typeof domainData === "object") {
      updatedDomainProfile = await updateDomainProfile(userId, domain, domainData);
    }

    if (!updatedProfile && !updatedDomainProfile) {
      return NextResponse.json(
        { error: "No valid update data provided. Send 'profile' and/or 'domain'+'domainData'." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      profile: updatedProfile,
      domainProfile: updatedDomainProfile,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}