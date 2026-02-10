# GoalFlow

AI-Powered Goal Achievement Web App - MVP (Phase 1-4)

GoalFlow helps users create goals with minimal input. The system uses AI agents (xAI) to automatically generate executable 7-day workflows, with daily email check-ins and weekly reviews.

## Developer Docs (Very Detailed)

Start here: `docs/00_INDEX.md`

## Features (Phase 1-4)

### Phase 1-2 (Core)
- ✅ User authentication (Credentials-based)
- ✅ Goal creation with minimal input
- ✅ AI-powered GoalSpec extraction (xAI)
- ✅ AI-powered 7-day plan generation (xAI)
- ✅ Goal dashboard and detail pages
- ✅ Plan visualization (7-day calendar)
- ✅ Check-in tracking (web)
- ✅ Streak calculation
- ✅ Timeline/event log

### Phase 3-4 (Email & Automation)
- ✅ Email integration (Resend)
- ✅ Daily check-in reminder emails
- ✅ OneTimeToken check-in landing pages (`/checkin/[token]`)
- ✅ Weekly review emails
- ✅ Weekly review landing pages (`/review/[token]`)
- ✅ WeeklyReviewer AI agent integration
- ✅ Plan Patch (adjust next week based on chosen option)
- ✅ Badge/achievement system
- ✅ Vercel Cron configuration

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL + Prisma
- **Auth**: NextAuth.js (Credentials)
- **AI**: xAI (Grok-4-latest) via OpenAI-style API
- **Email**: Resend
- **Validation**: Zod schemas
- **Deployment**: Vercel (with Cron)

## Prerequisites

- Node.js 18+ 
- PostgreSQL database
- xAI API key

## Setup

1. **Clone and install dependencies:**

```bash
npm install
```

2. **Set up environment variables:**

Copy `env.example` to `.env` and fill in:

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/goalflow?schema=public"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here" # Generate with: openssl rand -base64 32

# xAI API
XAI_API_KEY="your-xai-api-key-here"
XAI_BASE_URL="https://api.x.ai/v1"
XAI_MODEL="grok-4-latest"

# Email (Resend) - Required for Phase 3-4
RESEND_API_KEY="your-resend-api-key-here"
EMAIL_FROM="GoalFlow <noreply@yourdomain.com>"

# Cron Job Security (for production)
CRON_SECRET="your-cron-secret-here" # Generate with: openssl rand -base64 32

# App
APP_URL="http://localhost:3000"
```

3. **Set up database:**

```bash
# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push
```

4. **Run development server:**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
goalworkflow/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── auth/         # Authentication
│   │   ├── badges/       # Badge queries
│   │   ├── checkin/      # Check-in (web + token)
│   │   ├── cron/         # Cron job endpoints
│   │   ├── goals/        # Goal CRUD
│   │   ├── tokens/       # Token generation
│   │   └── weekly-review/ # Weekly review APIs
│   ├── auth/             # Auth pages
│   ├── checkin/[token]/  # Token check-in landing page
│   ├── dashboard/        # Dashboard page
│   ├── goals/            # Goal pages
│   ├── review/[token]/   # Weekly review landing page
│   └── layout.tsx        # Root layout
├── components/           # React components
│   └── ui/              # shadcn/ui components
├── lib/
│   ├── agents/          # AI agents
│   │   ├── goalAnalyzer.ts
│   │   ├── goalSpecExtractor.ts
│   │   ├── planGenerator.ts
│   │   └── weeklyReviewer.ts
│   ├── email/           # Email service (Resend)
│   │   ├── index.ts
│   │   ├── resend.ts
│   │   └── templates.ts
│   ├── llm/             # LLM client & guard
│   │   ├── xaiClient.ts
│   │   └── jsonGuard.ts
│   ├── schemas/         # Zod schemas
│   │   ├── goalSpec.ts
│   │   ├── plan.ts
│   │   └── weeklyReview.ts
│   ├── auth.ts          # NextAuth config
│   ├── badges.ts        # Badge service
│   ├── prisma.ts        # Prisma client
│   └── tokens.ts        # OneTimeToken utilities
├── prompts/             # AI prompts (versioned)
│   ├── goal_spec_extractor.md
│   ├── plan_generator.md
│   └── weekly_reviewer.md
├── prisma/
│   └── schema.prisma    # Database schema
└── vercel.json          # Vercel Cron configuration
```

## Key Components

### AI Agents

- **GoalSpecExtractor**: Extracts structured goal specification from user input
- **PlanGenerator**: Generates 7-day actionable plan from GoalSpec
- **WeeklyReviewer**: Analyzes progress and generates 3 next-week options

All agents use:
- xAI API (Grok-4-latest)
- JSON Guard (Zod validation + retry + fallback)
- Versioned prompts

### Data Models

- **User**: Authentication and profile
- **Goal**: User goals with GoalSpec JSON
- **Plan**: 7-day plans with Plan JSON
- **Task**: Daily tasks with Task JSON
- **Checkin**: Daily check-in records
- **WeeklyReview**: Weekly review with 3 options
- **EventLog**: Timeline events
- **Badge**: Achievement badges
- **OneTimeToken**: Email check-in tokens

## Usage

1. **Sign up** for an account
2. **Create a goal** (e.g., "Learn React in 7 days")
3. System automatically:
   - Extracts GoalSpec using AI
   - Generates 7-day plan using AI
   - Creates tasks in database
4. **View goal detail** page to see:
   - Today's tasks
   - 7-day calendar
   - Recent check-ins
   - Timeline

## Cron Jobs

Configured in `vercel.json` for Vercel deployment:

| Job | Schedule | Endpoint |
|-----|----------|----------|
| Daily Check-in Emails | 9:00 AM daily | `/api/cron/daily-checkin` |
| Weekly Review Emails | 10:00 AM Sunday | `/api/cron/weekly-review` |

For local testing, call the endpoints directly with the `CRON_SECRET` header:
```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/daily-checkin
```

## Notes

- All LLM calls happen server-side (no API keys in frontend)
- JSON output is strictly validated with Zod
- Failed LLM calls retry 2 times, then fallback to templates
- Prompts are versioned and stored in database

## License

MIT
