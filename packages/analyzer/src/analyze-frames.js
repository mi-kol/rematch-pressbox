#!/usr/bin/env node

/**
 * Demo script for testing with pre-extracted frames
 * Use this when you already have frames extracted (like the uploaded samples)
 * 
 * Usage: node analyze-frames.js <frames_directory> [options]
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  // How many frames to send in each API call
  chunkSize: 6,

  // Maximum number of chunks to process (null = process all)
  maxChunks: null,

  // Anthropic model to use
  model: "claude-sonnet-4-20250514",

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
  "frames": [
    {
      "timestamp": "MM:SS",
      "score": {"green": N, "blue": N},
      "events": ["GOAL", "PASS", "INTERCEPTION", "SAVE", "ASSIST"],
      "eventText": "exact text if shown",
      "eventPoints": "+250 etc if shown",
      "chatMessages": [{"player": "name", "message": "text"}],
      "povPlayerAction": "what POV player is doing",
      "povPlayerPosition": "defensive/midfield/attacking",
      "tacticalNote": "brief tactical observation",
      "action": "1-2 sentence description"
    }
  ],
  "chunkTacticalSummary": {
    "phase": "attacking/defending/transition",
    "keyMoments": ["moment 1", "moment 2"],
    "povPlayerRating": "1-10",
    "povPlayerHighlight": "best contribution",
    "povPlayerImprovement": "area to improve"
  },
  "chunkSummary": "2-3 sentence narrative"
}`;
}

const SYSTEM_PROMPT = buildSystemPrompt(CONFIG.player, CONFIG.tacticalAnalysis);

// ============================================================================
// IMAGE ENCODING
// ============================================================================

## Critical Instructions:
1. READ the timer and score EXACTLY from the HUD - don't estimate
2. Note score CHANGES between frames - this indicates goals
3. Event text in center-top is the most reliable indicator of what happened
4. If "[Player] has scored" appears, that's the definitive scorer
5. Chat messages provide context and player reactions
6. Use null for anything you cannot clearly read`;

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
// FRAME LOADING
// ============================================================================
function loadFrames(framesDir) {
  console.log(`\n📂 Loading frames from ${framesDir}...`);

  if (!fs.existsSync(framesDir)) {
    throw new Error(`Directory not found: ${framesDir}`);
  }

  const frames = fs
    .readdirSync(framesDir)
    .filter((f) => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
    .sort((a, b) => {
      // Sort numerically if possible
      const numA = parseInt(a.match(/\d+/)?.[0] || "0");
      const numB = parseInt(b.match(/\d+/)?.[0] || "0");
      return numA - numB;
    });

  console.log(`   ✓ Found ${frames.length} frames`);

  return frames.map((f) => path.join(framesDir, f));
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

  content.push({
    type: "text",
    text: `Analyze these ${framePaths.length} consecutive gameplay frames from Rematch. Extract game state from each frame. The frames are in chronological order.`,
  });

  // Add each frame as an image
  for (let i = 0; i < framePaths.length; i++) {
    const framePath = framePaths[i];
    const frameName = path.basename(framePath);

    content.push({
      type: "text",
      text: `Frame ${i + 1} (${frameName}):`,
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
    return JSON.parse(responseText);
  } catch {
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    console.warn("   ⚠️  Could not parse JSON response");
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
🎮 Rematch Frame Analyzer
=========================

Usage: node analyze-frames.js <frames_directory> [options]

Options:
  --chunk-size <n>  Frames per API call (default: ${CONFIG.chunkSize})
  --max-chunks <n>  Max chunks to process (default: all)
  --output <path>   Output JSON file (default: ${CONFIG.outputFile})
  --player <n>   POV player name (default: ${CONFIG.player.name})
  --jersey <number> POV player jersey (default: ${CONFIG.player.jerseyNumber})
  --team <color>    POV player team (default: ${CONFIG.player.team})
  --no-tactical     Disable tactical analysis

Example:
  node analyze-frames.js ./my_frames --chunk-size 6 --player y3lvin --jersey 77
`);
    process.exit(0);
  }

  // Parse arguments
  const framesDir = args[0];
  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
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

  console.log(`
🎮 Rematch Frame Analyzer
=========================
Frames Dir:  ${framesDir}
Chunk Size:  ${CONFIG.chunkSize}
Max Chunks:  ${CONFIG.maxChunks || "unlimited"}
Output:      ${CONFIG.outputFile}

👤 POV Player: ${CONFIG.player.name} (#${CONFIG.player.jerseyNumber}) - ${CONFIG.player.team} team
📊 Tactical:   ${CONFIG.tacticalAnalysis ? "enabled" : "disabled"}
`);

  // Initialize Anthropic client
  const client = new Anthropic();

  // Load frames
  const framePaths = loadFrames(framesDir);

  // Chunk frames
  let chunks = chunkArray(framePaths, CONFIG.chunkSize);
  if (CONFIG.maxChunks) {
    chunks = chunks.slice(0, CONFIG.maxChunks);
  }

  console.log(`\n📊 Processing ${chunks.length} chunks...`);

  // Process each chunk
  const gameLog = {
    metadata: {
      framesDir,
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
