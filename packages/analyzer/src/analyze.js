#!/usr/bin/env node

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  // How many frames to extract per second of video
  fps: 1, // Reduced from 2 for cost savings

  // How many frames to send in each API call (more = better context, higher cost)
  chunkSize: 12, // Increased from 6 for cost savings

  // Maximum number of chunks to process (null = process entire video)
  maxChunks: null,

  // Anthropic models - tiered approach for cost optimization
  basicModel: "claude-3-5-haiku-latest", // Cheap model for basic extraction
  advancedModel: "claude-sonnet-4-20250514", // Smart model for key moments

  // Legacy: single model setting (used when tiered mode is disabled)
  model: "claude-sonnet-4-20250514",

  // Enable tiered analysis (Haiku for basic, Sonnet for key moments)
  tieredAnalysis: true,

  // Directory for temporary frame extraction
  tempDir: "./temp_frames",

  // Output file for the game log
  outputFile: "./game_log.json",

  // Player configuration - who is the POV player?
  player: {
    name: "y3lvin",        // Your in-game name
    jerseyNumber: "77",    // Your jersey number
    team: "green",         // Your team color on scoreboard
  },

  // Enable tactical analysis
  tacticalAnalysis: true,
};

// ============================================================================
// SYSTEM PROMPT FOR GAME ANALYSIS
// ============================================================================
function buildSystemPrompt(playerConfig, tacticalAnalysis) {
  const playerContext = playerConfig 
    ? `
## POV Player Context:
You are analyzing from the perspective of "${playerConfig.name}" (#${playerConfig.jerseyNumber}) on the ${playerConfig.team} team.
- Track this player's positioning, movement, and contributions
- Note when they make good/poor decisions
- Highlight their involvement in plays (passes received, chances created, defensive actions)
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

  // Create temp directory
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  // Extract frames using ffmpeg
  const outputPattern = path.join(tempDir, "frame_%04d.jpg");
  const cmd = `ffmpeg -i "${videoPath}" -vf "fps=${fps}" -q:v 2 "${outputPattern}" -y 2>&1`;

  try {
    execSync(cmd, { stdio: "pipe" });
  } catch (error) {
    // ffmpeg often returns non-zero even on success, check if frames were created
    const frames = fs
      .readdirSync(tempDir)
      .filter((f) => f.endsWith(".jpg"))
      .sort();
    if (frames.length === 0) {
      throw new Error(`Frame extraction failed: ${error.message}`);
    }
  }

  const frames = fs
    .readdirSync(tempDir)
    .filter((f) => f.endsWith(".jpg"))
    .sort();
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

  // Build content array with images
  const content = [];

  // Add context about which frames these are
  content.push({
    type: "text",
    text: `Analyze these ${framePaths.length} consecutive gameplay frames. Extract game state from each frame.`,
  });

  // Add each frame as an image
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

  // Call Claude API
  const response = await client.messages.create({
    model: CONFIG.model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content }],
  });

  // Extract JSON from response
  const responseText = response.content[0].text;

  try {
    // Try to parse directly
    return JSON.parse(responseText);
  } catch {
    // Try to extract JSON from markdown code block
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    // Return raw text if we can't parse
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

  // Validate video exists
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

  // Initialize Anthropic client
  const client = new Anthropic();

  // Extract frames
  const framePaths = extractFrames(videoPath, CONFIG.fps, CONFIG.tempDir);

  // Chunk frames
  let chunks = chunkArray(framePaths, CONFIG.chunkSize);
  if (CONFIG.maxChunks) {
    chunks = chunks.slice(0, CONFIG.maxChunks);
  }

  console.log(`\n📊 Processing ${chunks.length} chunks...`);

  // Process each chunk
  const gameLog = {
    metadata: {
      videoPath,
      fps: CONFIG.fps,
      chunkSize: CONFIG.chunkSize,
      totalFrames: framePaths.length,
      chunksProcessed: chunks.length,
      analyzedAt: new Date().toISOString(),
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

      // Brief pause to avoid rate limits
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

  // Generate narrative summary
  try {
    gameLog.narrative = await generateNarrative(client, gameLog);
    console.log(`   ✓ Narrative generated`);
  } catch (error) {
    console.error(`   ❌ Narrative generation failed: ${error.message}`);
  }

  // Save output
  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(gameLog, null, 2));
  console.log(`\n✅ Game log saved to ${CONFIG.outputFile}`);

  // Cleanup temp frames
  if (fs.existsSync(CONFIG.tempDir)) {
    fs.rmSync(CONFIG.tempDir, { recursive: true });
    console.log(`🧹 Cleaned up temporary frames`);
  }

  // Print narrative
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
