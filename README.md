# Next.js + Supabase Auth (App Router)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="YOUR_ANON_KEY"

# Intervals.icu (server-side API route)
INTERVALS_ICU_API_KEY="YOUR_INTERVALS_ICU_API_KEY"
INTERVALS_ICU_ATHLETE_ID="0"

# Claude (Anthropic)
ANTHROPIC_API_KEY="YOUR_ANTHROPIC_API_KEY"
# Optional (defaults to claude-sonnet-4-0)
ANTHROPIC_MODEL="claude-sonnet-4-0"
```

3. Run dev server:

```bash
npm run dev
```

## Routes

- `/`: Home
- `/login`: Email/password login
- `/dashboard`: Protected (requires session)
- `/api/intervals/recent`: Server-side Intervals.icu proxy (supports `?days=14&limit=20`)
- `/api/chat`: Protected Claude proxy (streams text)

