# GoalFlow

AI-Powered Goal Achievement Web App - MVP (Phase 1-2)

GoalFlow helps users create goals with minimal input. The system uses AI agents (xAI) to automatically generate executable 7-day workflows, with daily email check-ins and weekly reviews.

## Developer Docs (Very Detailed)

Start here: `docs/00_INDEX.md`

## Features (Phase 1-2)

- ✅ User authentication (Credentials-based)
- ✅ Goal creation with minimal input
- ✅ AI-powered GoalSpec extraction (xAI)
- ✅ AI-powered 7-day plan generation (xAI)
- ✅ Goal dashboard and detail pages
- ✅ Plan visualization (7-day calendar)
- ✅ Check-in tracking
- ✅ Streak calculation
- ✅ Timeline/event log

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL + Prisma
- **Auth**: NextAuth.js (Credentials)
- **AI**: xAI (Grok-4-latest) via OpenAI-style API
- **Validation**: Zod schemas

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
│   │   └── goals/        # Goal CRUD
│   ├── auth/             # Auth pages
│   ├── dashboard/        # Dashboard page
│   ├── goals/            # Goal pages
│   └── layout.tsx        # Root layout
├── components/           # React components
│   └── ui/              # shadcn/ui components
├── lib/
│   ├── agents/          # AI agents
│   │   ├── goalSpecExtractor.ts
│   │   ├── planGenerator.ts
│   │   └── weeklyReviewer.ts
│   ├── llm/             # LLM client & guard
│   │   ├── xaiClient.ts
│   │   └── jsonGuard.ts
│   ├── schemas/         # Zod schemas
│   │   ├── goalSpec.ts
│   │   ├── plan.ts
│   │   └── weeklyReview.ts
│   ├── auth.ts          # NextAuth config
│   └── prisma.ts        # Prisma client
├── prompts/             # AI prompts (versioned)
│   ├── goal_spec_extractor.md
│   ├── plan_generator.md
│   └── weekly_reviewer.md
└── prisma/
    └── schema.prisma    # Database schema
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

## Phase 3-4 (Future)

- Email job (daily check-ins, weekly reviews)
- OneTimeToken check-in landing pages
- Weekly review agent integration
- Badge system
- Deployment configuration

## Notes

- All LLM calls happen server-side (no API keys in frontend)
- JSON output is strictly validated with Zod
- Failed LLM calls retry 2 times, then fallback to templates
- Prompts are versioned and stored in database

## License

MIT
