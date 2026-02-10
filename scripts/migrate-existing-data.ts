import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[Migration] Starting data migration...");

  // 1. Update existing goals with default classification fields
  const goalsWithoutDomain = await prisma.goal.findMany({
    where: { domain: null },
  });

  console.log(
    `[Migration] Found ${goalsWithoutDomain.length} goals without domain`
  );

  for (const goal of goalsWithoutDomain) {
    await prisma.goal.update({
      where: { id: goal.id },
      data: {
        domain: "general",
        complexity: "simple",
        planStructure: "fixed_cycle",
      },
    });
    console.log(`[Migration] Updated goal ${goal.id}: ${goal.title}`);
  }

  // 2. Create PlanVersion v1 for existing plans that don't have versions
  const plansWithoutVersions = await prisma.plan.findMany({
    where: {
      versions: { none: {} },
    },
  });

  console.log(
    `[Migration] Found ${plansWithoutVersions.length} plans without versions`
  );

  for (const plan of plansWithoutVersions) {
    await prisma.planVersion.create({
      data: {
        planId: plan.id,
        version: 1,
        content: plan.planJson as any,
        changeSource: "migration",
        changeSummary: "Initial version created by migration script",
      },
    });
    console.log(`[Migration] Created PlanVersion v1 for plan ${plan.id}`);
  }

  // 3. Create UserProfile for existing users that don't have one
  const usersWithoutProfile = await prisma.user.findMany({
    where: {
      profile: null,
    },
    select: { id: true, email: true },
  });

  console.log(
    `[Migration] Found ${usersWithoutProfile.length} users without profiles`
  );

  for (const user of usersWithoutProfile) {
    await prisma.userProfile.create({
      data: { userId: user.id },
    });
    console.log(
      `[Migration] Created profile for user ${user.id} (${user.email})`
    );
  }

  console.log("[Migration] Migration complete!");
}

main()
  .catch((e) => {
    console.error("[Migration] Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
