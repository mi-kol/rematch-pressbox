# Rematch Game Analyzer - Complete Technical Specification

## Overview

A Node.js tool that analyzes Rematch gameplay videos (a 3D arena soccer game similar to Rocket League) using Claude's vision API. It extracts structured game state data, tactical analysis, and generates narrative summaries from the POV player's perspective.

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Video File     │────▶│  ffmpeg      │────▶│  JPG Frames     │
│  (.mp4)         │     │  extraction  │     │  (1-4 fps)      │
└─────────────────┘     └──────────────┘     └────────┬────────┘
                                                      │
                                                      ▼
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Structured     │◀────│  Claude API  │◀────│  Chunked        │
│  JSON Output    │     │  (Vision)    │     │  Frame Batches  │
└────────┬────────┘     └──────────────┘     │  (6 frames/call)│
         │                                   └─────────────────┘
         ▼
┌─────────────────┐
│  Narrative      │
│  Summary        │
└─────────────────┘
```

## Core Components

### 1. Frame Extraction (ffmpeg)
- Extracts frames at configurable FPS (default: 2)
- Outputs as JPG for optimal size/quality balance
- Temporary storage, cleaned up after processing

### 2. Vision Analysis (Claude API)
- Processes frames in chunks (default: 6 frames per API call)
- Extracts HUD data (score, time, events)
- Identifies players, positions, tactical situations
- Tracks POV player specifically

### 3. Narrative Generation
- Synthesizes chunk analyses into cohesive summary
- Sports commentary style output

---

## Configuration

```javascript
const CONFIG = {
  // Frame extraction
  fps: 2,                    // Frames per second to extract
  
  // API batching
  chunkSize: 6,              // Frames per API call
  maxChunks: null,           // Limit chunks (null = all)
  
  // Model
  model: "claude-sonnet-4-20250514",
  
  // Output
  outputFile: "./game_log.json",
  
  // POV Player (for personalized analysis)
  player: {
    name: "y3lvin",
    jerseyNumber: "77",
    team: "green"            // "green" or "blue"
  },
  
  // Features
  tacticalAnalysis: true     // Enable tactical insights
};
```

### CLI Options

```
--fps <n>           Frames per second (default: 2)
--chunk-size <n>    Frames per API call (default: 6)
--max-chunks <n>    Max chunks to process (default: unlimited)
--output <path>     Output JSON path (default: game_log.json)
--player <name>     POV player name (default: y3lvin)
--jersey <number>   POV player jersey (default: 77)
--team <color>      POV player team (default: green)
--no-tactical       Disable tactical analysis
```

---

## Input: Rematch Game HUD Elements

The analyzer is trained to recognize these HUD elements:

### Top-Left Corner
- **Timer**: MM:SS format (counts down)
- **Score**: [GREEN_SCORE] [BLUE_SCORE]
- **Goal Attribution**: "[PlayerName] has scored" (appears after goals)
- **Chat Messages**: Player quick-chat and custom messages

### Center-Top (Event Indicators)
- `Pass` / `Pass +250` - Successful pass (points indicate quality)
- `GOAL!` - Goal scored
- `Assist` - Assist credited
- `Save` - Goalkeeper save
- `Interception` / `Interception +300` - Ball stolen
- `Cross it`, `Center it` - Quick chat callouts

### Visual Elements
- **Floating Labels**: Player names above characters with team number badges
- **Minimap (bottom-right)**: Oval field view, green triangles = teammates, yellow circle = ball
- **Goal Celebration**: Tornado/swirl effect when goal scored
- **Ability Effects**: Glowing trails when using special abilities
- **Stamina Bars**: Bottom center of screen

---

## Output Schema

### Top-Level Structure

```typescript
interface GameLog {
  metadata: {
    videoPath: string;
    fps: number;
    chunkSize: number;
    totalFrames: number;
    chunksProcessed: number;
    analyzedAt: string;           // ISO timestamp
    povPlayer?: {
      name: string;
      jerseyNumber: string;
      team: "green" | "blue";
    };
  };
  chunks: ChunkAnalysis[];
  narrative: string;              // Full play-by-play summary
}
```

### Chunk Analysis

```typescript
interface ChunkAnalysis {
  chunkIndex: number;
  frameRange: {
    start: string;               // e.g., "frame_0001.jpg"
    end: string;
  };
  analysis: {
    frames: FrameData[];
    chunkTacticalSummary?: {
      phase: "attacking" | "defending" | "transition";
      teamShape: string;
      keyMoments: string[];
      povPlayerRating: string;   // "1-10"
      povPlayerHighlight: string;
      povPlayerImprovement: string;
    };
    chunkSummary: string;        // 2-3 sentence narrative
  };
}
```

### Frame Data

```typescript
interface FrameData {
  timestamp: string;             // "MM:SS" from HUD
  score: {
    green: number;
    blue: number;
  };
  events: EventType[];
  eventText: string | null;      // Exact text shown
  eventPoints: string | null;    // "+250", "+300", etc.
  scorer: string | null;
  assister: string | null;
  ballCarrier: string | null;
  chatMessages: ChatMessage[];
  povPlayerAction: string;       // What POV player is doing
  povPlayerPosition: string;     // "defensive/midfield/attacking + left/center/right"
  tacticalNote: string;          // Brief tactical observation
  action: string;                // 1-2 sentence description
}

type EventType = "GOAL" | "PASS" | "INTERCEPTION" | "SAVE" | "ASSIST";

interface ChatMessage {
  player: string;
  message: string;
}
```

---

## Sample Output

### Minimal Example (Single Frame)

```json
{
  "timestamp": "01:48",
  "score": {"green": 2, "blue": 0},
  "events": ["GOAL"],
  "eventText": "GOAL!",
  "eventPoints": null,
  "scorer": null,
  "assister": null,
  "ballCarrier": null,
  "chatMessages": [
    {"player": "TacticalBBQ", "message": "Cross it"},
    {"player": "y3lvin", "message": "Good job!"}
  ],
  "povPlayerAction": "Celebrating in the box after goal",
  "povPlayerPosition": "attacking/center",
  "tacticalNote": "Clinical finish from wide attack. Team communication excellent.",
  "action": "GOAL! Score changes to 2-0. Massive celebration effect. Team celebrating."
}
```

### Full Chunk Example

```json
{
  "chunkIndex": 3,
  "frameRange": {
    "start": "frame_045.jpg",
    "end": "frame_057.jpg"
  },
  "analysis": {
    "frames": [
      {
        "timestamp": "01:51",
        "score": {"green": 1, "blue": 0},
        "events": ["CHAT"],
        "eventText": null,
        "eventPoints": null,
        "chatMessages": [
          {"player": "y3lvin", "message": "We got this!"},
          {"player": "TacticalBBQ", "message": "Cross it"}
        ],
        "povPlayerAction": "Making run toward the box",
        "povPlayerPosition": "midfield/center transitioning to attacking",
        "tacticalNote": "Wide attack developing. TacticalBBQ calling for service.",
        "action": "TacticalBBQ calls 'Cross it'. y3lvin pushing forward into the box."
      },
      {
        "timestamp": "01:48",
        "score": {"green": 1, "blue": 0},
        "events": ["PASS"],
        "eventText": "Pass +250",
        "eventPoints": "+250",
        "chatMessages": [{"player": "TacticalBBQ", "message": "Cross it"}],
        "povPlayerAction": "In the box attacking the cross",
        "povPlayerPosition": "attacking/center, penalty area",
        "tacticalNote": "Quality delivery into dangerous area.",
        "action": "Pass +250 - TacticalBBQ delivers the cross into the box."
      },
      {
        "timestamp": "01:48",
        "score": {"green": 2, "blue": 0},
        "events": ["GOAL"],
        "eventText": "GOAL!",
        "eventPoints": null,
        "chatMessages": [{"player": "y3lvin", "message": "Good job!"}],
        "povPlayerAction": "Celebrating",
        "povPlayerPosition": "penalty area",
        "tacticalNote": "Textbook wide attack executed perfectly.",
        "action": "GOAL! 2-0! Tornado celebration effect fills the arena."
      }
    ],
    "chunkTacticalSummary": {
      "phase": "attacking",
      "teamShape": "Wide attacking shape with TacticalBBQ providing width on right",
      "keyMoments": [
        "TacticalBBQ calls for cross",
        "Quality delivery +250",
        "GOAL scored"
      ],
      "povPlayerRating": "7",
      "povPlayerHighlight": "Good late run into box creating movement",
      "povPlayerImprovement": "Could time run slightly earlier"
    },
    "chunkSummary": "Beautiful team goal! TacticalBBQ communicates with 'Cross it', delivers a quality +250 pass, and the ball ends up in the net. Score: 2-0!"
  }
}
```

### Narrative Output Example

```
A masterclass in team play from the green squad. Already leading 1-0, they push for the killer second goal.

The sequence begins at 02:06 with green building an attack. y3lvin (#77) makes a well-timed run from midfield, joining TacticalBBQ and grace in a 4v3 overload against Eric_Blake and the blue defense.

The initial attack breaks down around 02:00, but here's where quality shows - green's counter-press is immediate and relentless. Within seconds, a teammate wins an Interception +300, stealing the ball right back in a dangerous area.

At 01:55, y3lvin shows leadership, sending 'We got this!' to rally the troops. The team resets, builds patiently.

Then at 01:51, the killer move develops. TacticalBBQ is wide right and knows it - 'Cross it!' comes the call. y3lvin makes a late run into the box, creating movement.

TacticalBBQ delivers. Pass +250 - a quality ball into the danger zone. At 01:48...

GOAL! 2-0!

The tornado celebration erupts as green extends their lead. y3lvin sends 'Good job!' to acknowledge the team effort.
```

---

## System Prompt (for Vision Analysis)

```javascript
function buildSystemPrompt(playerConfig, tacticalAnalysis) {
  const playerContext = playerConfig 
    ? `
## POV Player Context:
You are analyzing from the perspective of "${playerConfig.name}" (#${playerConfig.jerseyNumber}) on the ${playerConfig.team} team.
- Track this player's positioning, movement, and contributions
- Note when they make good/poor decisions
- Highlight their involvement in plays
- "${playerConfig.name}" messages in chat are from the POV player
`
    : '';

  const tacticalSection = tacticalAnalysis
    ? `
## Tactical Analysis:
Provide football/soccer tactical insight:
- Team shape and formation
- Passing patterns (build-up vs direct)
- Pressing and defensive shape
- Off-the-ball movement
- POV player positioning and decision-making
`
    : '';

  return `You are an expert analyst for "Rematch," a 3D arena soccer game (5v5).
${playerContext}
## HUD Elements:
- **Top-left**: Timer (MM:SS) and score [GREEN] [BLUE]
- **Center-top**: Events - "Pass +250", "GOAL!", "Interception +300", "Save", "Assist"
- **Below timer**: "[Player] has scored" after goals
- **Top-left chat**: Player messages
- **Floating labels**: Player names with team numbers

## Visual Elements:
- **Minimap (bottom-right)**: Field view, green triangles = teammates, yellow = ball
- **Goal celebration**: Tornado effect when goal scored
- **Ability effects**: Glowing trails when using abilities
${tacticalSection}
## Output format (ONLY valid JSON, no markdown):
{
  "frames": [...],
  "chunkTacticalSummary": {...},
  "chunkSummary": "..."
}`;
}
```

---

## Code Files

### analyze.js (Main Entry Point)

```javascript
#!/usr/bin/env node

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  fps: 2,
  chunkSize: 6,
  maxChunks: null,
  model: "claude-sonnet-4-20250514",
  tempDir: "./temp_frames",
  outputFile: "./game_log.json",
  player: {
    name: "y3lvin",
    jerseyNumber: "77",
    team: "green",
  },
  tacticalAnalysis: true,
};

// ============================================================================
// SYSTEM PROMPT BUILDER
// ============================================================================
function buildSystemPrompt(playerConfig, tacticalAnalysis) {
  const playerContext = playerConfig 
    ? `
## POV Player Context:
You are analyzing from the perspective of "${playerConfig.name}" (#${playerConfig.jerseyNumber}) on the ${playerConfig.team} team.
- Track this player's positioning, movement, and contributions
- Note when they make good/poor decisions
- Highlight their involvement in plays
- "${playerConfig.name}" messages in chat are from the POV player
`
    : '';

  const tacticalSection = tacticalAnalysis
    ? `
## Tactical Analysis (IMPORTANT):
Provide football/soccer tactical insight for each sequence:

**Phases of Play:**
- Attacking: Build-up, chance creation, finishing
- Defending: Pressing, shape, recovery runs
- Transition: Counter-attacks, defensive transitions

**Key Tactical Elements to Identify:**
- Team shape and formation tendencies
- Passing patterns (short build-up vs direct)
- Width and depth of attacks
- Pressing triggers and defensive line
- Key passes and through balls
- Off-the-ball movement and runs
- 1v1 situations and duels
- Support play and third-man runs

**For the POV player specifically:**
- Positioning relative to teammates and opponents
- Decision-making quality (pass selection, when to shoot, when to dribble)
- Work rate and defensive contribution
- Movement to create space or receive passes
`
    : '';

  return `You are an expert analyst for "Rematch," a 3D arena soccer game similar to Rocket League but with human characters (5v5).

Your job is to analyze gameplay frames and extract structured game state data with tactical insight.
${playerContext}
## HUD Elements (READ THESE PRECISELY):
- **Top-left corner**: Timer (MM:SS format) and score. Format: [TIME] [GREEN_SCORE] [BLUE_SCORE]
- **Center-top**: Event indicators appear here:
  - "Pass" / "Pass +250" - successful pass (points indicate quality)
  - "GOAL!" - goal scored
  - "Assist" - assist credited  
  - "Save" - goalkeeper save
  - "Interception" / "Interception +300" - ball stolen (points indicate quality)
  - "Cross it", "Center it" - quick chat callouts
- **Below timer (top-left)**: "[PlayerName] has scored" appears after goals
- **Top-left chat area**: Player messages like "Good job!", "We got this!"
- **Floating labels**: Player names above characters with team number badges

## Visual Elements:
- **Minimap (bottom-right)**: Oval field view, green triangles = teammates, yellow circle = ball
- **Goal celebration**: Massive tornado/swirl visual effect when goal scored
- **Ability effects**: Glowing trails, energy bursts when using special abilities
- **Stamina bars**: Bottom center of screen
${tacticalSection}
## Your output format:
Return ONLY valid JSON (no markdown, no code blocks):
{
  "frames": [
    {
      "timestamp": "MM:SS from HUD",
      "score": {"green": N, "blue": N},
      "events": ["GOAL", "PASS", "INTERCEPTION", "SAVE", "ASSIST"],
      "eventText": "exact text shown if any",
      "eventPoints": "number if shown (+250, +300, etc)",
      "scorer": "PlayerName or null",
      "assister": "PlayerName or null",
      "ballCarrier": "PlayerName or null",
      "chatMessages": [{"player": "name", "message": "text"}],
      "povPlayerAction": "what the POV player is doing",
      "povPlayerPosition": "defensive/midfield/attacking + left/center/right",
      "tacticalNote": "brief tactical observation about team shape, movement, or play",
      "action": "1-2 sentence description of the play"
    }
  ],
  "chunkTacticalSummary": {
    "phase": "attacking/defending/transition",
    "teamShape": "description of formation and positioning",
    "keyMoments": ["moment 1", "moment 2"],
    "povPlayerRating": "1-10 for POV player contribution",
    "povPlayerHighlight": "best thing POV player did",
    "povPlayerImprovement": "what could be better"
  },
  "chunkSummary": "2-3 sentence narrative of what happened"
}

## Critical Instructions:
1. READ the timer and score EXACTLY from the HUD
2. Note score CHANGES between frames - this indicates goals
3. Event text in center-top is most reliable for what happened
4. Track POV player movement and positioning throughout
5. Identify tactical patterns in team play
6. Use null for anything you cannot clearly read`;
}

const SYSTEM_PROMPT = buildSystemPrompt(CONFIG.player, CONFIG.tacticalAnalysis);

// ============================================================================
// FRAME EXTRACTION
// ============================================================================
function extractFrames(videoPath, fps, tempDir) {
  console.log(`\n📹 Extracting frames at ${fps} fps...`);

  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  const outputPattern = path.join(tempDir, "frame_%04d.jpg");
  const cmd = `ffmpeg -i "${videoPath}" -vf "fps=${fps}" -q:v 2 "${outputPattern}" -y 2>&1`;

  try {
    execSync(cmd, { stdio: "pipe" });
  } catch (error) {
    const frames = fs.readdirSync(tempDir).filter((f) => f.endsWith(".jpg")).sort();
    if (frames.length === 0) {
      throw new Error(`Frame extraction failed: ${error.message}`);
    }
  }

  const frames = fs.readdirSync(tempDir).filter((f) => f.endsWith(".jpg")).sort();
  console.log(`   ✓ Extracted ${frames.length} frames`);

  return frames.map((f) => path.join(tempDir, f));
}

// ============================================================================
// IMAGE ENCODING
// ============================================================================
function encodeImageToBase64(imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  return imageBuffer.toString("base64");
}

function getMediaType(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  const types = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return types[ext] || "image/jpeg";
}

// ============================================================================
// CHUNK PROCESSING
// ============================================================================
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function analyzeChunk(client, framePaths, chunkIndex, totalChunks, systemPrompt) {
  console.log(`\n🔍 Analyzing chunk ${chunkIndex + 1}/${totalChunks} (${framePaths.length} frames)...`);

  const content = [];

  content.push({
    type: "text",
    text: `Analyze these ${framePaths.length} consecutive gameplay frames. Extract game state from each frame.`,
  });

  for (let i = 0; i < framePaths.length; i++) {
    const framePath = framePaths[i];
    const frameNum = path.basename(framePath, ".jpg").replace("frame_", "");

    content.push({
      type: "text",
      text: `Frame ${frameNum}:`,
    });

    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: getMediaType(framePath),
        data: encodeImageToBase64(framePath),
      },
    });
  }

  const response = await client.messages.create({
    model: CONFIG.model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content }],
  });

  const responseText = response.content[0].text;

  try {
    return JSON.parse(responseText);
  } catch {
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    console.warn("   ⚠️  Could not parse JSON response, storing raw text");
    return { raw: responseText };
  }
}

// ============================================================================
// NARRATIVE GENERATION
// ============================================================================
async function generateNarrative(client, gameLog) {
  console.log(`\n📝 Generating narrative summary...`);

  const response = await client.messages.create({
    model: CONFIG.model,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Based on this structured game log from a Rematch soccer game, write an engaging play-by-play narrative summary. Focus on key moments, goals, saves, and team coordination.

Game Log:
${JSON.stringify(gameLog, null, 2)}

Write a natural, engaging summary as if you're a sports commentator recapping the action. Keep it concise but capture the excitement.`,
      },
    ],
  });

  return response.content[0].text;
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
🎮 Rematch Game Analyzer
========================

Usage: node analyze.js <video_path> [options]

Options:
  --fps <n>           Frames per second to extract (default: ${CONFIG.fps})
  --chunk-size <n>    Frames per API call (default: ${CONFIG.chunkSize})
  --max-chunks <n>    Max chunks to process (default: all)
  --output <path>     Output JSON file (default: ${CONFIG.outputFile})
  --player <name>     POV player name (default: ${CONFIG.player.name})
  --jersey <number>   POV player jersey number (default: ${CONFIG.player.jerseyNumber})
  --team <color>      POV player team color (default: ${CONFIG.player.team})
  --no-tactical       Disable tactical analysis

Example:
  node analyze.js gameplay.mp4 --fps 2 --chunk-size 6 --player y3lvin --jersey 77
`);
    process.exit(0);
  }

  // Parse arguments
  const videoPath = args[0];
  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case "--fps":
        CONFIG.fps = parseFloat(args[++i]);
        break;
      case "--chunk-size":
        CONFIG.chunkSize = parseInt(args[++i]);
        break;
      case "--max-chunks":
        CONFIG.maxChunks = parseInt(args[++i]);
        break;
      case "--output":
        CONFIG.outputFile = args[++i];
        break;
      case "--player":
        CONFIG.player.name = args[++i];
        break;
      case "--jersey":
        CONFIG.player.jerseyNumber = args[++i];
        break;
      case "--team":
        CONFIG.player.team = args[++i];
        break;
      case "--no-tactical":
        CONFIG.tacticalAnalysis = false;
        break;
    }
  }

  // Rebuild system prompt with updated config
  const SYSTEM_PROMPT_FINAL = buildSystemPrompt(CONFIG.player, CONFIG.tacticalAnalysis);

  if (!fs.existsSync(videoPath)) {
    console.error(`❌ Video file not found: ${videoPath}`);
    process.exit(1);
  }

  console.log(`
🎮 Rematch Game Analyzer
========================
Video:      ${videoPath}
FPS:        ${CONFIG.fps}
Chunk Size: ${CONFIG.chunkSize}
Max Chunks: ${CONFIG.maxChunks || "unlimited"}
Output:     ${CONFIG.outputFile}

👤 POV Player: ${CONFIG.player.name} (#${CONFIG.player.jerseyNumber}) - ${CONFIG.player.team} team
📊 Tactical:   ${CONFIG.tacticalAnalysis ? "enabled" : "disabled"}
`);

  const client = new Anthropic();

  const framePaths = extractFrames(videoPath, CONFIG.fps, CONFIG.tempDir);

  let chunks = chunkArray(framePaths, CONFIG.chunkSize);
  if (CONFIG.maxChunks) {
    chunks = chunks.slice(0, CONFIG.maxChunks);
  }

  console.log(`\n📊 Processing ${chunks.length} chunks...`);

  const gameLog = {
    metadata: {
      videoPath,
      fps: CONFIG.fps,
      chunkSize: CONFIG.chunkSize,
      totalFrames: framePaths.length,
      chunksProcessed: chunks.length,
      analyzedAt: new Date().toISOString(),
      povPlayer: CONFIG.player,
    },
    chunks: [],
    narrative: null,
  };

  for (let i = 0; i < chunks.length; i++) {
    try {
      const chunkResult = await analyzeChunk(client, chunks[i], i, chunks.length, SYSTEM_PROMPT_FINAL);
      gameLog.chunks.push({
        chunkIndex: i,
        frameRange: {
          start: path.basename(chunks[i][0]),
          end: path.basename(chunks[i][chunks[i].length - 1]),
        },
        analysis: chunkResult,
      });
      console.log(`   ✓ Chunk ${i + 1} complete`);

      if (i < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (error) {
      console.error(`   ❌ Chunk ${i + 1} failed: ${error.message}`);
      gameLog.chunks.push({
        chunkIndex: i,
        error: error.message,
      });
    }
  }

  try {
    gameLog.narrative = await generateNarrative(client, gameLog);
    console.log(`   ✓ Narrative generated`);
  } catch (error) {
    console.error(`   ❌ Narrative generation failed: ${error.message}`);
  }

  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(gameLog, null, 2));
  console.log(`\n✅ Game log saved to ${CONFIG.outputFile}`);

  if (fs.existsSync(CONFIG.tempDir)) {
    fs.rmSync(CONFIG.tempDir, { recursive: true });
    console.log(`🧹 Cleaned up temporary frames`);
  }

  if (gameLog.narrative) {
    console.log(`\n${"=".repeat(60)}`);
    console.log("📺 GAME SUMMARY");
    console.log("=".repeat(60));
    console.log(gameLog.narrative);
    console.log("=".repeat(60));
  }
}

main().catch((error) => {
  console.error(`\n❌ Fatal error: ${error.message}`);
  process.exit(1);
});
```

### package.json

```json
{
  "name": "rematch-analyzer",
  "version": "1.0.0",
  "description": "Analyze Rematch gameplay videos and generate structured game logs with AI",
  "type": "module",
  "main": "analyze.js",
  "scripts": {
    "analyze": "node analyze.js",
    "demo": "node analyze.js sample.mp4 --fps 2 --chunk-size 6 --max-chunks 3"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

## Integration as a Service/Module

### As an ES Module

```javascript
// rematch-ocr.js
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

export class RematchOCR {
  constructor(config = {}) {
    this.config = {
      model: "claude-sonnet-4-20250514",
      chunkSize: 6,
      player: null,
      tacticalAnalysis: true,
      ...config
    };
    this.client = new Anthropic();
  }

  /**
   * Analyze an array of frame paths
   * @param {string[]} framePaths - Array of paths to JPG frame files
   * @returns {Promise<Object>} - Structured game analysis
   */
  async analyzeFrames(framePaths) {
    const systemPrompt = this.buildSystemPrompt();
    const chunks = this.chunkArray(framePaths, this.config.chunkSize);
    
    const results = {
      metadata: {
        totalFrames: framePaths.length,
        chunksProcessed: chunks.length,
        analyzedAt: new Date().toISOString(),
        povPlayer: this.config.player,
      },
      chunks: [],
    };

    for (let i = 0; i < chunks.length; i++) {
      const chunkResult = await this.analyzeChunk(chunks[i], systemPrompt);
      results.chunks.push({
        chunkIndex: i,
        frameRange: {
          start: path.basename(chunks[i][0]),
          end: path.basename(chunks[i][chunks[i].length - 1]),
        },
        analysis: chunkResult,
      });
    }

    return results;
  }

  /**
   * Analyze a single frame
   * @param {string} framePath - Path to JPG frame file
   * @returns {Promise<Object>} - Frame analysis
   */
  async analyzeSingleFrame(framePath) {
    const result = await this.analyzeFrames([framePath]);
    return result.chunks[0]?.analysis?.frames?.[0] || null;
  }

  // ... (internal methods: buildSystemPrompt, analyzeChunk, chunkArray, etc.)
}

// Usage:
// const ocr = new RematchOCR({ player: { name: "y3lvin", jerseyNumber: "77", team: "green" } });
// const result = await ocr.analyzeFrames(["frame1.jpg", "frame2.jpg", ...]);
```

### As a REST API Endpoint (Express Example)

```javascript
import express from "express";
import multer from "multer";
import { RematchOCR } from "./rematch-ocr.js";

const app = express();
const upload = multer({ dest: "uploads/" });
const ocr = new RematchOCR();

app.post("/analyze", upload.array("frames"), async (req, res) => {
  try {
    const framePaths = req.files.map(f => f.path);
    const playerConfig = req.body.player ? JSON.parse(req.body.player) : null;
    
    ocr.config.player = playerConfig;
    const result = await ocr.analyzeFrames(framePaths);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000);
```

---

## Cost Estimation

| Video Length | FPS | Frames | Chunks (size 6) | Est. Cost |
|--------------|-----|--------|-----------------|-----------|
| 30 seconds   | 2   | 60     | 10              | $0.15-0.20 |
| 1 minute     | 2   | 120    | 20              | $0.30-0.40 |
| 5 minutes    | 2   | 600    | 100             | $1.50-2.00 |
| 5 minutes    | 4   | 1200   | 200             | $3.00-4.00 |

Cost per chunk with claude-sonnet: ~$0.015-0.02 (depending on image complexity)

---

## Known Limitations

1. **Occlusion**: Ball/players behind other objects may not be detected
2. **Fast Motion**: At 1-2 FPS, very fast plays may be missed between frames
3. **Custom Skins**: Non-standard player appearances may affect detection
4. **Minimap Reading**: Detailed minimap analysis is limited
5. **Spectator Mode**: Optimized for first-person POV, spectator view may vary

---

## Event Types Reference

| Event | HUD Text | Points | Meaning |
|-------|----------|--------|---------|
| PASS | "Pass" / "Pass +250" | 0-250 | Successful pass |
| GOAL | "GOAL!" | - | Goal scored |
| ASSIST | "Assist" | - | Assist on goal |
| SAVE | "Save" | - | Goalkeeper save |
| INTERCEPTION | "Interception" / "Interception +300" | 0-300 | Ball stolen |

---

## Quick Start

```bash
# 1. Install
npm install

# 2. Set API key
export ANTHROPIC_API_KEY="sk-..."

# 3. Analyze a video
node analyze.js gameplay.mp4 --player YourName --jersey 77 --team green

# 4. Or analyze pre-extracted frames
node analyze-frames.js ./frames_folder --player YourName
```
