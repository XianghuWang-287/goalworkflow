# GoalFlow Setup Guide

## Quick Start Checklist

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up PostgreSQL Database

Create a PostgreSQL database:
```sql
CREATE DATABASE goalflow;
```

Or use a service like Supabase, Neon, or Railway.

### 3. Configure Environment Variables

Copy `env.example` to `.env`:
```bash
cp env.example .env
```

Then edit `.env` and update the values:

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/goalflow?schema=public"

# NextAuth - Generate secret with: openssl rand -base64 32
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-generated-secret-here"

# xAI API - Get your key from https://x.ai
XAI_API_KEY="your-xai-api-key"
XAI_BASE_URL="https://api.x.ai/v1"
XAI_MODEL="grok-4-latest"

# App
APP_URL="http://localhost:3000"
```

### 4. Initialize Database

```bash
# Generate Prisma client
npm run db:generate

# Push schema to database (creates tables)
npm run db:push
```

### 5. Start Development Server

```bash
npm run dev
```

Visit http://localhost:3000

## Testing the Flow

1. **Sign Up**: Create a new account at `/auth/signup`
2. **Create Goal**: Go to Dashboard → Create New Goal
   - Enter a goal like "Learn React in 7 days"
   - System will automatically:
     - Extract GoalSpec using xAI
     - Generate 7-day plan using xAI
     - Create tasks in database
3. **View Goal**: Click on the goal to see:
   - Today's tasks
   - 7-day calendar
   - Check-in history
   - Timeline

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` is correct
- Ensure PostgreSQL is running
- Check database exists

### xAI API Issues
- Verify `XAI_API_KEY` is set correctly
- Check API key has proper permissions
- Ensure network can reach `https://api.x.ai`

### Authentication Issues
- Ensure `NEXTAUTH_SECRET` is set
- Clear browser cookies if session issues occur

### Build Errors
- Run `npm run db:generate` after schema changes
- Delete `.next` folder and rebuild: `rm -rf .next && npm run build`

## Next Steps (Phase 3-4)

- [ ] Email job setup (Resend/Postmark)
- [ ] Daily check-in emails
- [ ] OneTimeToken landing pages
- [ ] Weekly review emails
- [ ] Badge system
- [ ] Deployment configuration
