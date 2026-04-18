# Claude Code Handoff

## Project
- Name: `moshicom-event-filter`
- Stack: Next.js 14 App Router / TypeScript / Tailwind / Supabase / cheerio
- Purpose: Crawl public Moshicom events, store Kansai running and trail events in Supabase, and show them with filters on the web UI.

## Current Git State
- Branch: `main`
- Latest commit: `83018a8 Initial commit: moshicom event filter v1`
- Working tree: clean

## Current App State
- Local build passes with `npm run build`
- Manual verification completed for:
  - `/api/events`
  - `/api/excluded-organizers`
  - `/api/admin/crawl`
  - top page UI
- Current verified counts:
  - `saved_total = 52`
  - default visible total = `48`
  - `last_scraped_at` is returned and displayed
- `excluded_organizers` flow is working after DB table creation:
  - add excluded organizer
  - list excluded organizers
  - remove excluded organizer
  - reflect exclusion in `/api/events`

## What Was Fixed

### 1. Crawler / parsing
- Moshicom event URLs are treated as `https://moshicom.com/{numeric_id}`
- List parsing was adjusted to the real card structure: `.event-card h3 a`
- Detail parsing was strengthened for:
  - `organizer`
  - `venue_or_area`
  - `description`
- Blank organizer values are excluded from organizer-volume aggregation

### 2. Events API
- File: [app/api/events/route.ts](C:/Users/user/claude-practice/moshicom-app/app/api/events/route.ts)
- Returns:
  - `events`
  - `total`
  - `saved_total`
  - `last_scraped_at`
- Default filters:
  - `exclude_member_recruitment = true`
  - `exclude_high_volume_organizers = false`
  - `exclude_excluded_organizers = true`

### 3. Excluded organizers
- File: [app/api/excluded-organizers/route.ts](C:/Users/user/claude-practice/moshicom-app/app/api/excluded-organizers/route.ts)
- Implemented:
  - `GET /api/excluded-organizers`
  - `POST /api/excluded-organizers`
  - `DELETE /api/excluded-organizers`
- `excluded_organizers` missing-table message was localized and clarified

### 4. DB / Supabase
- File: [supabase/schema.sql](C:/Users/user/claude-practice/moshicom-app/supabase/schema.sql)
- Added `excluded_organizers` table with:
  - `id`
  - `organizer_name unique`
  - `created_at`
- Added RLS and policies for `events` and `excluded_organizers`
- Fixed `getLastScrapedAt()` behavior
- Added `getEventsTotalCount()`

### 5. Stale read fix
- File: [lib/db.ts](C:/Users/user/claude-practice/moshicom-app/lib/db.ts)
- Supabase client is created with `fetch(..., { cache: 'no-store' })`
- Reason:
  - without this, updates to `excluded_organizers` could succeed but `/api/events` could continue serving stale filtered results from cached Supabase GET reads

### 6. UI
- File: [app/page.tsx](C:/Users/user/claude-practice/moshicom-app/app/page.tsx)
- Layout order:
  - header
  - filter card
  - excluded organizers card
  - summary
  - event cards
- Verified visible items:
  - saved count
  - visible count
  - last updated
  - exclusion controls
  - event cards

### 7. Git safety
- `.gitignore` updated to exclude:
  - `.env.local`
  - `.next`
  - `node_modules`
  - Codex logs
  - temp HTML files
  - local screenshots
- `.env.local.example` was rewritten to placeholders only

## Key Files To Read First
- [README.md](C:/Users/user/claude-practice/moshicom-app/README.md)
- [supabase/schema.sql](C:/Users/user/claude-practice/moshicom-app/supabase/schema.sql)
- [app/page.tsx](C:/Users/user/claude-practice/moshicom-app/app/page.tsx)
- [app/api/events/route.ts](C:/Users/user/claude-practice/moshicom-app/app/api/events/route.ts)
- [app/api/excluded-organizers/route.ts](C:/Users/user/claude-practice/moshicom-app/app/api/excluded-organizers/route.ts)
- [lib/db.ts](C:/Users/user/claude-practice/moshicom-app/lib/db.ts)
- [lib/moshicom/parse.ts](C:/Users/user/claude-practice/moshicom-app/lib/moshicom/parse.ts)
- [lib/moshicom/crawler.ts](C:/Users/user/claude-practice/moshicom-app/lib/moshicom/crawler.ts)
- [lib/moshicom/normalize.ts](C:/Users/user/claude-practice/moshicom-app/lib/moshicom/normalize.ts)

## Quick Start
1. Copy env template:
   - `cp .env.local.example .env.local`
2. Fill in real Supabase and Cron values
3. Apply DB schema:
   - open Supabase SQL Editor
   - run [supabase/schema.sql](C:/Users/user/claude-practice/moshicom-app/supabase/schema.sql)
4. Install deps:
   - `npm install`
5. Start dev server:
   - `npm run dev`

## Quick Smoke Test Commands

### Home page
```powershell
Invoke-WebRequest http://localhost:3000/ -UseBasicParsing
```

### Events API
```powershell
Invoke-RestMethod http://localhost:3000/api/events
Invoke-RestMethod "http://localhost:3000/api/events?exclude_excluded_organizers=false"
```

### Manual crawl
```powershell
Invoke-RestMethod http://localhost:3000/api/admin/crawl -Method POST
```

### Excluded organizers CRUD
```powershell
$body = @{ organizer_name = "トレイルランナーズ大阪" } | ConvertTo-Json
Invoke-RestMethod http://localhost:3000/api/excluded-organizers -Method POST -ContentType "application/json; charset=utf-8" -Body $body
Invoke-RestMethod http://localhost:3000/api/excluded-organizers
Invoke-RestMethod http://localhost:3000/api/events
Invoke-RestMethod "http://localhost:3000/api/events?exclude_excluded_organizers=false"
Invoke-RestMethod http://localhost:3000/api/excluded-organizers -Method DELETE -ContentType "application/json; charset=utf-8" -Body $body
```

## Verified Exclusion Behavior
- Before excluding `トレイルランナーズ大阪`:
  - `/api/events` total = `48`
- After adding it to `excluded_organizers`:
  - `/api/events` total = `20`
  - `/api/events?exclude_excluded_organizers=false` total = `48`
- After removing it:
  - `/api/events` total returns to `48`

## Known Risks / Notes
- `.env.local.example` used to contain real-looking values earlier in the session. It has already been replaced with placeholders before commit, but if those values were real in any environment, rotate:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `CRON_SECRET`
- Moshicom HTML structure is a dependency. If crawl results drop unexpectedly, inspect:
  - URL shape
  - list card selectors
  - detail page labels / DOM
- The app currently relies on fetch + cheerio. If Moshicom becomes more JS-driven, Playwright may become necessary.

## Next Recommended Tasks

### Highest priority
- Create GitHub repository `moshicom-event-filter`
- Add remote and push `main`
- Connect GitHub repo to Vercel
- Set Vercel environment variables
- Apply [supabase/schema.sql](C:/Users/user/claude-practice/moshicom-app/supabase/schema.sql) to the production Supabase project
- Verify Vercel cron behavior

### Product follow-ups
- Favorites feature
- New-event notifications
- LINE / Slack notification integration
- Exclusion reason memo
- Personal recommendation logic

## Notes For Claude Code
- Do not commit `.env.local`
- Do not restore or delete ignored debug artifacts unless explicitly asked
- If `/api/events` looks stale after exclusion updates, inspect `lib/db.ts` first and preserve the `no-store` behavior
- Prefer validating changes with real HTTP responses and counts, not assumptions
- If crawl counts drop to zero again, start from `lib/moshicom/parse.ts` and `lib/moshicom/crawler.ts`
