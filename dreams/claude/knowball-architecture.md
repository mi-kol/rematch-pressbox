# Knowball Architecture Document

## System Overview

Knowball transforms raw Rematch gameplay recordings into published sports journalism through an automated pipeline. The system bridges the gap between real gaming sessions and a fictional sports media universe.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              KNOWBALL SYSTEM                                     │
│                                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  MEDAL   │───▶│COLLECTOR │───▶│    DB    │───▶│PUBLISHER │───▶│  BLOG    │  │
│  │ (Record) │    │  (Watch) │    │(Supabase)│    │(Generate)│    │(Netlify) │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│                       │               ▲               │                         │
│                       ▼               │               │                         │
│                  ┌──────────┐    ┌──────────┐        │                         │
│                  │   OCR    │    │ DISCORD  │◀───────┘                         │
│                  │(Extract) │    │   BOT    │                                   │
│                  └──────────┘    └──────────┘                                   │
│                                      │                                          │
│                                      ▼                                          │
│                                 ┌──────────┐                                    │
│                                 │ PLAYERS  │                                    │
│                                 │(Respond) │                                    │
│                                 └──────────┘                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow (v0.5)

### Complete Pipeline

```
                                    THE KNOWBALL PIPELINE
                                    =====================

    ┌─────────────────────────────────────────────────────────────────────────┐
    │                           1. CAPTURE PHASE                              │
    │                                                                         │
    │   Rematch Game ──▶ Medal Recording ──▶ MP4 saved to disk               │
    │                                                                         │
    │   Output: /Medal/clips/rematch_2024-01-15_001.mp4                       │
    └─────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
    ┌─────────────────────────────────────────────────────────────────────────┐
    │                           2. DETECTION PHASE                            │
    │                                                                         │
    │   Collector (filesystem watcher)                                        │
    │   ├── Detects new MP4 in Medal directory                               │
    │   ├── Groups by timestamp proximity → Session                           │
    │   └── Creates records in Supabase                                       │
    │                                                                         │
    │   Output: session record, match record(s), video metadata               │
    └─────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
    ┌─────────────────────────────────────────────────────────────────────────┐
    │                          3. EXTRACTION PHASE                            │
    │                                                                         │
    │   Frame Extractor                                                       │
    │   ├── ffmpeg extracts last 30s of video                                │
    │   ├── Identifies scoreboard/end-screen frames                          │
    │   └── Saves candidate frames for OCR                                    │
    │                                                                         │
    │   OCR Pipeline                                                          │
    │   ├── Tesseract processes candidate frames                             │
    │   ├── Pattern matching for score format                                │
    │   ├── Confidence scoring                                               │
    │   └── Falls back to manual input if confidence < threshold             │
    │                                                                         │
    │   Output: { our_goals: 3, opp_goals: 2, confidence: "high" }           │
    └─────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
    ┌─────────────────────────────────────────────────────────────────────────┐
    │                        4. PRESS CONFERENCE PHASE                        │
    │                                                                         │
    │   Discord Bot                                                           │
    │   ├── Triggered by new session (or /pressconf command)                 │
    │   ├── Selects journalist persona                                       │
    │   ├── Pulls questions from bank (weighted random)                      │
    │   ├── Posts questions to channel, collects responses                   │
    │   └── Saves answers to press_answers table                             │
    │                                                                         │
    │   Output: Array of { question, player, answer } records                 │
    └─────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
    ┌─────────────────────────────────────────────────────────────────────────┐
    │                         5. GENERATION PHASE                             │
    │                                                                         │
    │   AI Recap Generator                                                    │
    │   ├── Fetches session data (matches, scores, players)                  │
    │   ├── Fetches quotes from press conference                             │
    │   ├── Fetches journalist persona                                       │
    │   ├── Fetches historical context (H2H, streaks, standings)             │
    │   ├── Constructs prompt with all context                               │
    │   └── Claude API generates article                                      │
    │                                                                         │
    │   Output: Markdown article with frontmatter                             │
    └─────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
    ┌─────────────────────────────────────────────────────────────────────────┐
    │                         6. PUBLISHING PHASE                             │
    │                                                                         │
    │   Publisher                                                             │
    │   ├── Validates markdown structure                                     │
    │   ├── Writes to blog/_posts/YYYY-MM-DD-slug.md                         │
    │   ├── Git commit with message                                          │
    │   ├── Git push to origin                                               │
    │   └── Updates article record with URL, published_at                    │
    │                                                                         │
    │   Netlify (automatic)                                                   │
    │   ├── Detects push to main branch                                      │
    │   ├── Runs Jekyll build                                                │
    │   └── Deploys to knowball.netlify.app                                  │
    │                                                                         │
    │   Output: Live article at https://knowball.netlify.app/posts/slug      │
    └─────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
    ┌─────────────────────────────────────────────────────────────────────────┐
    │                         7. NOTIFICATION PHASE                           │
    │                                                                         │
    │   Discord Bot                                                           │
    │   ├── Posts article link to announcement channel                       │
    │   └── Optional: Tags players mentioned in article                      │
    │                                                                         │
    │   Output: Discord message with article preview                          │
    └─────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Collector (`apps/collector/`)

**Purpose:** Watch for new Medal recordings and create database records.

**Technology:** Node.js with `chokidar` for filesystem watching

**Key Responsibilities:**
- Watch Medal's output directory for new MP4 files
- Group recordings by time proximity into sessions
- Create `session` and `match` records in Supabase
- Trigger downstream processing (OCR, press conference)

**Configuration:**
```javascript
{
  medalPath: "C:/Users/{user}/Documents/Medal/clips",
  watchPatterns: ["*.mp4"],
  sessionGapMinutes: 30,  // New session if >30min between recordings
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY
}
```

**State Machine:**
```
IDLE ──(new MP4)──▶ PROCESSING ──(session created)──▶ IDLE
                         │
                         ├──(OCR triggered)──▶ OCR_PENDING
                         │
                         └──(error)──▶ ERROR ──(retry/skip)──▶ IDLE
```

---

### 2. OCR Pipeline (`packages/ocr/`)

**Purpose:** Extract scores and stats from end-game screenshots.

**Technology:** Tesseract.js (local) with Google Vision API fallback

**Key Responsibilities:**
- Extract frames from video using ffmpeg
- Identify scoreboard regions
- OCR text from score areas
- Pattern match for score format (e.g., "3 - 2")
- Return structured data with confidence levels

**Frame Extraction Strategy:**
```bash
# Extract frames from last 30 seconds (likely contains end screen)
ffmpeg -sseof -30 -i input.mp4 -vf "fps=2" -q:v 2 frames/frame_%03d.jpg

# Alternative: Extract specific timestamps if end screen time is known
ffmpeg -ss 00:05:30 -i input.mp4 -vframes 1 end_screen.jpg
```

**OCR Output Schema:**
```typescript
interface OCRResult {
  our_goals: number | null;
  opp_goals: number | null;
  confidence: 'high' | 'medium' | 'low';
  coverage: number;  // 0-1, what percentage of expected data was found
  raw_text: string;  // For debugging
  frame_path: string;
  method: 'tesseract' | 'google_vision' | 'manual';
}
```

**Confidence Levels:**
- `high`: Clear score read, pattern matched perfectly
- `medium`: Score readable but some uncertainty (e.g., OCR confidence < 90%)
- `low`: Partial read or required inference

---

### 3. Discord Bot (`apps/discord-bot/`)

**Purpose:** Conduct press conferences and notify about new articles.

**Technology:** discord.js v14

**Key Commands:**

| Command | Description |
|---------|-------------|
| `/pressconf latest` | Start press conference for most recent session |
| `/pressconf session:{id}` | Start press conference for specific session |
| `/publish latest` | Manually trigger article generation |
| `/status` | Show pipeline status (pending OCR, articles, etc.) |

**Press Conference Flow:**
```
1. Bot posts intro: "Post-match press conference with {journalist.name}"
2. For each question (3-5 questions):
   a. Bot posts question, tags relevant player(s)
   b. Wait for response (timeout: 5 minutes)
   c. Save answer to press_answers
3. Bot posts outro: "Thank you. Article incoming."
4. Trigger article generation
```

**Question Selection:**
- Pull from `press_questions` table
- Weight by `weight` column (higher = more likely)
- Filter by `active = true` and `min_version` compatibility
- Substitute placeholders: `{player}`, `{score}`, `{opponent}`

---

### 4. AI Generator (`packages/ai/`)

**Purpose:** Generate sports journalism articles from structured data.

**Technology:** Claude API (Anthropic)

**Prompt Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                     SYSTEM PROMPT                           │
│                                                             │
│  You are {journalist.name}, writing for Knowball.           │
│  Style: {journalist.persona.writing_style}                  │
│  Tone: {journalist.persona.tone}                            │
│  Biases: {journalist.persona.biases}                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     CONTEXT BLOCK                           │
│                                                             │
│  Session: {date}, {match_count} matches                     │
│  Results: [{ our_goals, opp_goals, confidence }, ...]       │
│  Players: [{ name, goals, assists }, ...]                   │
│  Historical: H2H record, current streak, standings          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      QUOTES BLOCK                           │
│                                                             │
│  Available quotes from press conference:                    │
│  - {player}: "{answer}" (re: {question_summary})            │
│  - ...                                                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    GENERATION TASK                          │
│                                                             │
│  Write a {word_count}-word recap article.                   │
│  Include: headline, subhead, 3-5 paragraphs                 │
│  Integrate at least 2 quotes naturally.                     │
│  Reference historical context if relevant.                  │
│  Output as markdown with YAML frontmatter.                  │
└─────────────────────────────────────────────────────────────┘
```

**Output Format:**
```markdown
---
layout: post
title: "Headline Here"
date: 2024-01-15 22:30:00 -0600
author: journalist-slug
tags: [recap, session]
session_id: uuid-here
---

Article content here...
```

---

### 5. Publisher (`apps/publisher/`)

**Purpose:** Automate the blog publishing workflow.

**Technology:** Node.js with `simple-git`

**Workflow:**
```javascript
async function publish(article: Article) {
  // 1. Validate markdown
  validateMarkdown(article.content_md);
  
  // 2. Generate filename
  const filename = `${formatDate(article.published_at)}-${article.slug}.md`;
  const filepath = `blog/_posts/${filename}`;
  
  // 3. Write file
  await fs.writeFile(filepath, article.content_md);
  
  // 4. Git operations
  await git.add(filepath);
  await git.commit(`Add article: ${article.title}`);
  await git.push('origin', 'main');
  
  // 5. Update database
  await supabase
    .from('articles')
    .update({ 
      status: 'published',
      published_at: new Date(),
      url: `https://knowball.netlify.app/posts/${article.slug}`
    })
    .eq('id', article.id);
  
  // 6. Notify Discord
  await discordBot.announce(article);
}
```

---

### 6. Blog (`blog/`)

**Purpose:** Static site serving the published articles.

**Technology:** Jekyll on Netlify

**Structure:**
```
blog/
├── _config.yml
├── _layouts/
│   ├── default.html
│   ├── post.html
│   └── home.html
├── _includes/
│   ├── header.html
│   └── footer.html
├── _posts/
│   └── YYYY-MM-DD-slug.md
├── assets/
│   ├── css/
│   └── images/
└── index.html
```

**Netlify Configuration:**
```toml
[build]
  command = "jekyll build"
  publish = "_site"

[build.environment]
  JEKYLL_ENV = "production"
```

---

## Database Schema Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              SUPABASE SCHEMA                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐            │
│  │   leagues    │◀────────│   seasons    │         │   players    │            │
│  ├──────────────┤    1:N  ├──────────────┤         ├──────────────┤            │
│  │ id (PK)      │         │ id (PK)      │         │ id (PK)      │            │
│  │ name         │         │ league_id(FK)│         │ league_id(FK)│            │
│  │ created_at   │         │ name         │         │ discord_id   │            │
│  └──────────────┘         └──────────────┘         │ display_name │            │
│         │                        │                 │ nicknames[]  │            │
│         │                        │                 └──────────────┘            │
│         │ 1:N                    │ 1:N                    │                    │
│         ▼                        ▼                        │                    │
│  ┌──────────────┐         ┌──────────────┐               │                    │
│  │  journalists │         │   sessions   │               │                    │
│  ├──────────────┤         ├──────────────┤               │                    │
│  │ id (PK)      │         │ id (PK)      │               │                    │
│  │ league_id(FK)│         │ league_id(FK)│               │                    │
│  │ name         │         │ season_id(FK)│               │                    │
│  │ slug         │         │ video_id     │               │                    │
│  │ persona{}    │         └──────────────┘               │                    │
│  │ active       │                │                       │                    │
│  └──────────────┘                │ 1:N                   │                    │
│         │                        ▼                       │                    │
│         │                 ┌──────────────┐               │                    │
│         │                 │   matches    │               │                    │
│         │                 ├──────────────┤               │                    │
│         │                 │ id (PK)      │               │                    │
│         │                 │ session_id(FK)│              │                    │
│         │                 │ video_id     │               │                    │
│         │                 │ match_index  │               │                    │
│         │                 │ our_goals    │               │                    │
│         │                 │ opp_goals    │               │                    │
│         │                 │ confidence   │               │                    │
│         │                 └──────────────┘               │                    │
│         │                        │                       │                    │
│         │                        │ 1:N                   │                    │
│         │                        ▼                       │                    │
│         │                 ┌──────────────┐               │                    │
│         │                 │match_player_ │◀──────────────┘                    │
│         │                 │    stats     │         N:1                        │
│         │                 ├──────────────┤                                    │
│         │                 │ match_id(FK) │                                    │
│         │                 │ player_id(FK)│                                    │
│         │                 │ goals        │                                    │
│         │                 │ assists      │                                    │
│         │                 └──────────────┘                                    │
│         │                                                                     │
│         │ 1:N                                                                 │
│         ▼                                                                     │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐          │
│  │   articles   │         │    press_    │◀────────│    press_    │          │
│  ├──────────────┤         │ conferences  │    1:N  │   answers    │          │
│  │ id (PK)      │         ├──────────────┤         ├──────────────┤          │
│  │ journalist_id│         │ id (PK)      │         │ conf_id (FK) │          │
│  │ session_id   │         │ session_id   │         │ question_id  │          │
│  │ title        │         │ journalist_id│         │ discord_id   │          │
│  │ content_md   │         │ started_at   │         │ answer       │          │
│  │ status       │         │ ended_at     │         └──────────────┘          │
│  │ published_at │         └──────────────┘                ▲                  │
│  └──────────────┘                                         │                  │
│                                                           │ N:1              │
│                                                    ┌──────────────┐          │
│                                                    │    press_    │          │
│                                                    │  questions   │          │
│                                                    ├──────────────┤          │
│                                                    │ id (PK)      │          │
│                                                    │ template     │          │
│                                                    │ weight       │          │
│                                                    │ active       │          │
│                                                    └──────────────┘          │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Error Handling & Fallbacks

### OCR Failures

```
OCR attempt ──▶ Confidence check
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
    HIGH/MEDIUM                LOW
        │                       │
        ▼                       ▼
   Use result            Retry with different
        │                    settings
        │                       │
        │               ┌───────┴───────┐
        │               ▼               ▼
        │           SUCCESS          FAILURE
        │               │               │
        │               ▼               ▼
        │          Use result      Manual input
        │               │           prompt via
        │               │           Discord
        ▼               ▼               │
    ┌───────────────────────────────────┘
    ▼
Continue pipeline
```

### Generation Failures

```
AI Generation ──▶ Validation
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
       VALID                  INVALID
          │                       │
          ▼                       ▼
    Publish article          Retry (max 2)
                                  │
                          ┌───────┴───────┐
                          ▼               ▼
                       SUCCESS         FAILURE
                          │               │
                          ▼               ▼
                    Publish         Use template
                                    fallback
                                         │
                                         ▼
                                   Publish with
                                   "basic" template
```

---

## v0.5 Implementation Checklist

### Phase 1: Collector Setup
- [ ] Initialize `apps/collector/` project structure
- [ ] Install dependencies: `chokidar`, `@supabase/supabase-js`
- [ ] Implement filesystem watcher for Medal directory
- [ ] Add session grouping logic (time proximity)
- [ ] Create Supabase insertion for sessions and matches
- [ ] Test with sample MP4 files

### Phase 2: OCR Pipeline
- [ ] Initialize `packages/ocr/` project structure
- [ ] Install dependencies: `tesseract.js`, `fluent-ffmpeg`
- [ ] Implement frame extraction from video
- [ ] Build OCR processing with confidence scoring
- [ ] Add pattern matching for score format
- [ ] Test with sample end-screen frames
- [ ] Document failure cases

### Phase 3: Press Conference Integration
- [ ] Ensure Discord bot can be triggered programmatically
- [ ] Add auto-trigger when session is created
- [ ] Implement timeout handling for unanswered questions
- [ ] Test end-to-end: new session → press conference starts

### Phase 4: Publisher Automation
- [ ] Initialize `apps/publisher/` project structure
- [ ] Install dependencies: `simple-git`
- [ ] Update AI generator to use real session data
- [ ] Implement markdown validation
- [ ] Add git commit/push automation
- [ ] Update article records in Supabase
- [ ] Test end-to-end: session → article on live site

### Phase 5: Integration Testing
- [ ] Full pipeline test with real gameplay session
- [ ] Verify all fallbacks work correctly
- [ ] Document any manual intervention required
- [ ] Performance benchmarking (time from recording to publish)

---

## Future Architecture (v1.0+)

### v1.0 Additions
```
                    ┌──────────────┐
                    │   MOMENT     │
                    │  DETECTOR    │
                    ├──────────────┤
                    │ Goal overlay │
                    │ detection    │
                    │ Clip gen     │
                    └──────────────┘
                          │
                          ▼
                    ┌──────────────┐
                    │    CDN /     │
                    │   STORAGE    │
                    ├──────────────┤
                    │ Clip hosting │
                    │ Thumbnails   │
                    └──────────────┘
```

### v1.5 Additions
```
                    ┌──────────────┐
                    │  JOURNALIST  │
                    │   MEMORY     │
                    ├──────────────┤
                    │ Relationships│
                    │ Past quotes  │
                    │ Storylines   │
                    └──────────────┘
                          │
                          ▼
                    ┌──────────────┐
                    │  OPPONENT    │
                    │  TRACKER     │
                    ├──────────────┤
                    │ Handle OCR   │
                    │ Frequency    │
                    │ Canon mgmt   │
                    └──────────────┘
```

---

## Appendix: Environment Variables

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_KEY=xxx  # For server-side operations

# Discord
DISCORD_BOT_TOKEN=xxx
DISCORD_GUILD_ID=xxx
DISCORD_PRESS_CHANNEL_ID=xxx
DISCORD_ANNOUNCE_CHANNEL_ID=xxx

# Claude API
ANTHROPIC_API_KEY=xxx

# Local Paths (Windows)
MEDAL_CLIPS_PATH=C:\Users\Mex\Documents\Medal\clips

# Git (for publisher)
GIT_REPO_PATH=C:\path\to\knowball\blog
GIT_REMOTE=origin
GIT_BRANCH=main
```
