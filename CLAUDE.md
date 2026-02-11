# GoalFlow — CLAUDE.md

> AI-powered goal achievement platform. This file is the single source of truth for development context.

## Tech Stack

- **Framework:** Next.js 14 (App Router) + TypeScript
- **UI:** Tailwind CSS + shadcn/ui (Radix primitives)
- **Database:** PostgreSQL + Prisma ORM
- **Auth:** NextAuth.js (Credentials, JWT strategy)
- **AI/LLM:** xAI Grok-4 via OpenAI-compatible API
- **Email:** Resend
- **Validation:** Zod (all LLM output + API input)
- **Deployment:** Vercel + Vercel Cron

## Project Structure

```
app/                    # Next.js App Router
  api/                  # API route handlers
    auth/               # signup, [...nextauth]
    goals/              # analyze, create, conversation, [id]/delete
    checkin/            # web checkin + token-based checkin
    weekly-review/      # POST generate, GET fetch, PATCH choose option, token/ sub-route
    badges/             # badge queries
    cron/               # daily-email, weekly-review triggers
    profile/            # user profile CRUD
    tokens/             # one-time token generation
  auth/                 # signin, signup pages
  dashboard/            # main dashboard
  goals/
    create/             # goal creation (chat + plan preview)
    [id]/               # goal detail page
      review/           # authenticated weekly review page
  checkin/[token]/      # token-based checkin landing
  review/[token]/       # token-based weekly review landing

lib/
  agents/               # AI agent modules
    classifier.ts       # Goal Classifier (domain, complexity, plan structure)
    domainExpert.ts     # Domain Expert (multi-turn conversation)
    planGenerator.ts    # Plan Generator (constraint-aware, multi-structure)
    planModifier.ts     # Plan Modifier (card edit + natural language)
    weeklyReviewer.ts   # Weekly Reviewer (metrics → options)
    goalSpecExtractor.ts
    orchestrator.ts     # Fast/deep path routing
  llm/
    xaiClient.ts        # xAI API wrapper (sync + streaming)
    jsonGuard.ts        # LLM output → Zod validation + retry
  schemas/              # Zod schemas (plan, goalSpec, userProfile, etc.)
  knowledge/            # Domain knowledge bases (fitness, learning, etc.)
  profile/              # User profile manager (cross-goal coordination)
  constraints/          # Code-level constraint validator
  email/                # Resend email service
  badges.ts             # Badge award logic
  tokens.ts             # One-time token management
  prisma.ts             # Prisma client singleton
  auth.ts               # NextAuth config

prompts/                # Versioned LLM prompt templates (*.md)
scripts/                # Dev/test scripts
  simulate-checkins.ts  # Simulate 7-day checkins
  trigger-email.ts      # Trigger email manually
docs/                   # Technical documentation
  plans/                # Architecture designs & implementation plans
```

## Development Commands

```bash
npm run dev             # Start dev server (localhost:3000)
npm run build           # Production build
npm run db:generate     # Regenerate Prisma client
npm run db:push         # Push schema changes to DB
npm run db:studio       # Open Prisma Studio
npm run sim:checkins    # Simulate 7-day checkins for testing
npm run email:daily     # Trigger daily email
npm run email:weekly    # Trigger weekly review email
```

## Architecture Decisions

- **All LLM calls server-side only** — API keys never exposed to client
- **JSONGuard pattern** — Every LLM call goes through `callAndValidate()`: parse JSON → Zod validate → retry up to 2x with error feedback → fallback template
- **Prompt versioning** — `prompts/*.md` with version headers; `Plan.promptVersion` tracks which prompt generated it
- **Fast/Deep routing** — Classifier determines if goal is simple (skip conversation, generate plan directly) or complex (multi-turn domain expert conversation first)
- **Constraint validation in code** — Time conflicts, schedule constraints validated by `constraintValidator.ts`, not by LLM
- **User profiles persist across goals** — Wake time, sleep time, work days, available slots shared between goals for cross-goal coordination

## Key Patterns

- Server Components for data fetching pages (goal detail, dashboard)
- Client Components only when interactivity needed (`"use client"`)
- API routes use `getServerSession(authOptions)` for auth
- Token-based routes (checkin, review) use `validateAndConsumeToken()` — no session needed
- Plan dates may have ±1 day offset from task dates (task dates come from plan generation, plan day.date is the display date)

## Current Development Phase

See `docs/08_DEVELOPMENT_PROGRESS.md` for detailed phase-by-phase progress tracking.

**Completed:** Phase 1 (MVP Core) → Phase 2 (Intelligent Agents) → Phase 3-4 (Email/Badges/Checkin/Review) → Checkin Status + Weekly Review Loop → Weekly Review UX Redesign

**In Progress:** SSE Streaming UX, UI polish, production hardening

## Testing

- `npx tsx scripts/simulate-checkins.ts` — Creates 7 checkins (5 done, 1 partial, 1 missed) for the first active goal
- `npx tsx scripts/simulate-checkins.ts --goalId=xxx` — Target specific goal
- `npx tsx scripts/simulate-checkins.ts --review` — Also trigger weekly review email
- Manual testing via browser: create goal → checkin → verify day card status → weekly review flow
