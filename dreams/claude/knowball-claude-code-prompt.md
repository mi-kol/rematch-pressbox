# Knowball — Claude Code System Prompt

You are working on **Knowball**, an automated fictional sports journalism system that generates news coverage for a real gaming group's Rematch sessions. This is a passion project with serious technical ambition.

---

## Project Overview

**What is this?**
A system that watches recorded Rematch gameplay, extracts match data via OCR, conducts Discord "press conferences" with players, and publishes AI-generated sports journalism to a live blog.

**Why does it exist?**
The developers (@Mex, @Samir, @Grace, @Tweek, @Eric_Blake) play Rematch regularly. To add stakes and narrative to their sessions, they're building a fictional sports universe around their gameplay — complete with journalists, rival teams, and an evolving storyline.

**The core loop:**
1. Mex records every match via Medal on Windows 11
2. A local collector detects new recordings and creates sessions
3. OCR extracts scores from end-game screens
4. Discord bot runs press conferences, collecting player quotes
5. AI generates recap articles grounded in real data + quotes
6. Articles auto-publish to knowball.netlify.app

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Database | Supabase (Postgres) |
| Backend/Bot | Node.js, discord.js |
| AI | Claude API (Anthropic) |
| Blog | Jekyll → Netlify (auto-deploy on git push) |
| Local Collector | Node.js on Windows 11 (filesystem watcher) |
| OCR | TBD (likely Tesseract or Google Vision API) |
| Recordings | Medal (saves MP4s to local directory) |

---

## Database Schema (Supabase)

Key tables and their relationships:

```
leagues
├── id (uuid, PK)
├── name
└── created_at

seasons
├── id (uuid, PK)
├── league_id → leagues.id
├── name
└── ...

sessions (a play session, contains multiple matches)
├── id (uuid, PK)
├── league_id → leagues.id
├── season_id → seasons.id
├── video_id (optional, if single recording)
└── ...

matches (individual games within a session)
├── id (uuid, PK)
├── league_id → leagues.id
├── session_id → sessions.id
├── video_id → videos.id (the Medal recording)
├── match_index (order within session)
├── our_goals, opp_goals
├── score_confidence (high/medium/low)
├── score_coverage (0-1, what % of match was visible)
└── notes

match_player_stats
├── match_id → matches.id
├── player_discord_user_id
├── goals, assists, passes, interceptions
├── coverage, confidence
└── ...

players
├── id (uuid, PK)
├── league_id → leagues.id
├── discord_user_id (links to real Discord user)
├── display_name
├── nicknames (array)
└── ...

journalists (AI personas who write articles)
├── id (uuid, PK)
├── league_id → leagues.id
├── name, slug
├── persona (jsonb - writing style, biases, relationships)
├── active
└── ...

press_conferences
├── id (uuid, PK)
├── session_id → sessions.id
├── journalist_id → journalists.id
├── discord_channel_id
├── started_at, ended_at
└── ...

press_questions (template bank)
├── id (uuid, PK)
├── league_id → leagues.id
├── tag (category)
├── template (with placeholders like {player}, {score})
├── weight (for random selection)
├── active
├── min_version (feature flag)
└── ...

press_answers
├── press_conference_id → press_conferences.id
├── press_question_id → press_questions.id
├── discord_user_id (who answered)
├── answer (the quote)
└── ...

articles
├── id (uuid, PK)
├── league_id → leagues.id
├── session_id, season_id (context)
├── journalist_id → journalists.id
├── type (recap, profile, rumor, etc.)
├── title, slug, status
├── content_md (the article body in Markdown)
├── url (netlify URL once published)
├── published_at
├── author (display name)
├── tags (array)
├── meta (jsonb)
└── ...

moments (notable events extracted from video)
├── id (uuid, PK)
├── session_id, match_id, video_id
├── source (ocr, manual, ai)
├── t_s (timestamp in seconds)
├── text (description)
├── tags (goal, save, blunder, etc.)
└── ...

quotes (may be separate from press_answers for other sources)
├── id (uuid, PK)
└── ...
```

---

## Current State (Pre-v0.5)

What exists:
- ✅ Supabase tables seeded with league, season, journalists, question bank
- ✅ Jekyll blog deploys to Netlify from `_posts/`
- ✅ Discord `/pressconf latest` command asks questions and saves answers
- ✅ AI recap generator exists but uses fake/hardcoded match data
- ✅ Manual publishing workflow (write markdown → git commit/push → bot posts URL)

What's missing for v0.5:
- ❌ Local collector (filesystem watcher for Medal recordings)
- ❌ Session creation from new MP4s
- ❌ OCR pipeline for scoreboard extraction
- ❌ Automated publishing (no manual markdown writing)
- ❌ Real match data flowing into recaps

---

## Version Roadmap

### v0.5 (Current Target) — Grounded Recaps
Goal: Recaps are about real sessions with real scores, fully automated.

- Local collector watches Medal output directory for new MP4s
- Creates session records, links recordings
- Extracts 1-2 scoreboard frames (end screen preferred)
- OCR reads final score with confidence levels
- Recap uses real session date + real score
- Publishing is fully automated (no manual post writing)
- Graceful fallback if OCR fails (prompt for manual input or skip)

### v1.0 — Match Moments + Media
- Detect goal moments (goal overlay signature in video)
- Auto-generate goal clips around timestamps
- Recap includes timeline section with goal times + clip links
- System fails gracefully if detection misses

### v1.5 — The Journalist Update
- Journalist depth: relationships per journalist↔player, memory objects
- Opponent tracking: OCR reads opponent handles, frequent opponent detection
- Matchday model: sessions framed as matchdays, pre-match desk notes, post-match grading

### Beyond — Newsroom Sim Era
- Rumor mill generates storylines as case files
- Journalist agents investigate with NPC sources
- Multi-journalist ecosystem (editor desk, feuds, corrections)
- Voice press conferences (VC audio → transcript → quotes)

---

## Key Design Principles

1. **Graceful degradation**: Every step should have fallbacks. OCR fails? Prompt manual input. AI generates garbage? Use a template fallback. Never block publishing.

2. **Confidence tracking**: All extracted data carries confidence levels (high/medium/low) and coverage percentages. Articles should reflect uncertainty appropriately.

3. **Real data over fake data**: The whole point is grounding fiction in reality. Prefer partial real data over complete fake data.

4. **Minimal manual intervention**: Some manual tasks are acceptable (adding questions, updating player associations) but the core loop should be hands-off.

5. **Narrative consistency**: The fictional league database is the source of truth. All generated content must reference it to maintain coherent storylines.

---

## Directory Structure (Actual)

**Monorepo: `rematch-pressbox/`**
```
rematch-pressbox/
├── apps/                   # Application entry points (mostly empty, collector will live here)
├── packages/
│   └── core/               # Shared code
│       ├── schemas/        # Zod schemas or similar
│       ├── src/
│       │   ├── prompts/    # AI prompt templates
│       │   ├── db.js       # Supabase client
│       │   ├── openai.js   # OpenAI/Claude API wrapper
│       │   ├── recap.js    # Article generation logic
│       │   ├── publish.js  # Publishing utilities
│       │   └── dossier.js  # Player/team dossier generation
│       └── package.json
├── scripts/
│   ├── seed-data/
│   │   ├── journalists.js
│   │   ├── league.js
│   │   └── press-questions.js
│   └── seed.js
├── .env
├── .gitignore
├── package.json            # Root package.json (workspaces)
├── package-lock.json
├── README.md
├── roadmap.md
├── schema.md
├── versions.md
└── vision.md
```

**Separate Repo: `pressbox-blog/`** (GitHub Pages deployment)
```
pressbox-blog/
├── src/
│   ├── _includes/
│   │   └── base.njk        # Base Nunjucks template
│   ├── assets/
│   │   └── styles.css
│   ├── posts/              # Article markdown files
│   │   ├── 2026-01-01-welcome.md
│   │   └── 2026-01-07-knowball-matchday-notes-*.md
│   ├── index.njk
│   ├── journalists.njk
│   └── recaps.njk
├── _site/                  # Eleventy build output (gitignored)
├── netlify/
│   └── functions/          # Netlify serverless functions (if any)
├── .eleventy.js            # Eleventy config
├── .gitignore
├── package.json
└── package-lock.json
```

**Key insight:** The blog is Eleventy + Nunjucks (not Jekyll). Posts go in `src/posts/` with frontmatter format:
```markdown
---
title: knowball matchday notes
date: 2026-01-07
tags: ["post", "recap"]
layout: base.njk
---
```

---

## Working With This Codebase

### Environment
- Node.js (use latest LTS)
- pnpm preferred for package management
- Windows 11 for local collector (Medal integration)
- VSCode with Claude Code extension

### Database Access
```bash
# Supabase CLI for local dev
supabase start
supabase db reset
```

### Common Tasks

**Adding a new Discord command:**
1. Create command file in `apps/discord-bot/commands/`
2. Register in command loader
3. Test with Discord dev bot

**Adding a new journalist:**
1. Insert into `journalists` table with persona JSON
2. Persona should include: writing_style, tone, biases, favorite_topics

**Modifying the recap generator:**
1. Prompts live in `packages/ai/prompts/`
2. Test with real data from Supabase, not hardcoded packets

**Publishing an article:**
1. Generate markdown with Eleventy-compatible frontmatter
2. Write to `pressbox-blog/src/posts/YYYY-MM-DD-slug.md`
3. Git commit + push to the blog repo
4. GitHub Pages / Netlify auto-builds via Eleventy

**Eleventy frontmatter format:**
```markdown
---
title: knowball matchday notes
date: 2026-01-07
tags: ["post", "recap"]
layout: base.njk
---
```

---

## OCR Strategy Notes

Rematch end screens typically show:
- Final score prominently displayed
- Player names/handles
- Basic stats (goals, assists)

Recommended approach:
1. Use ffmpeg to extract frames near end of video
2. Look for score overlay pattern (numbers prominently displayed)
3. Start with Tesseract (free, local) — tune with custom training if needed
4. Fall back to Google Vision API if Tesseract struggles
5. Always return confidence level based on OCR certainty scores

Frame extraction command:
```bash
# Extract last 30 seconds, 1 frame per second
ffmpeg -sseof -30 -i input.mp4 -vf fps=1 frame_%03d.png
```

---

## AI Generation Guidelines

When generating recaps:
1. Always include real data (date, score, player names)
2. Integrate player quotes naturally, attributed properly
3. Match journalist persona (check `journalists.persona` JSON)
4. Reference historical context from database when relevant
5. Keep paragraphs short, punchy — sports journalism style
6. Never invent quotes; only use what's in `press_answers`

Prompt structure:
```
[System: You are {journalist.name}, a sports journalist for Knowball. Your style: {journalist.persona.writing_style}]

[Context: Match data, historical context, league standings]

[Quotes: Available player quotes from press conference]

[Task: Write a {word_count} word recap of today's session]
```

---

## Testing & Validation

Before committing:
1. Run type checks (`tsc --noEmit`)
2. Test Discord commands in dev server
3. Validate generated markdown renders correctly
4. Check Supabase constraints aren't violated

For OCR development:
1. Collect sample end-screen frames from real recordings
2. Test OCR accuracy on sample set
3. Document failure cases for future training

---

## Current Priorities (v0.5)

In order of implementation:

1. **Collector skeleton**: Filesystem watcher that detects new MP4s in Medal directory
2. **Session creation**: When MP4 detected, create session + match records in Supabase
3. **Frame extraction**: Use ffmpeg to pull candidate scoreboard frames
4. **OCR pipeline**: Extract score from frames, store with confidence
5. **Publisher automation**: Generate recap from real data, auto-commit to blog repo
6. **End-to-end test**: Play a session, verify article appears on site without manual intervention

---

## Contacts & Resources

- **Live site**: https://knowball.netlify.app
- **Supabase project**: [check .env for connection string]
- **Discord server**: [dev's private server]
- **Medal recordings**: Default path on Windows, usually `C:\Users\{user}\Documents\Medal\`

---

## Notes for Claude Code

- This is a real project with real users (the gaming group). Quality matters.
- Mex is the primary developer. The friends are players/stakeholders.
- The fictional journalism angle is the soul of the project — preserve the vibe.
- When in doubt, add fallbacks. Never let the pipeline block on one failing step.
- OCR is the current frontier. Expect iteration and experimentation.
- Keep code modular — the v1.5 journalist update will add significant complexity.
