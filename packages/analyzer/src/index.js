/**
 * Rematch Video Analyzer
 *
 * Cost-optimized analysis using:
 * - Haiku for basic frame extraction (~$0.01/chunk)
 * - Sonnet for key moments only (~$0.02-0.03/call)
 *
 * Target cost: ~$0.15-0.25 per 5-min match (vs $1.50-2.00 originally)
 */

export { analyzeChunkBasic, detectGoals, aggregateStats } from "./analyze-basic.js";
export {
  analyzeGoalSequence,
  generateTacticalSummary,
  generateNarrative,
  getGoalSequenceFrames,
} from "./analyze-moments.js";
export {
  initDb,
  saveAnalysis,
  getAnalysis,
  getGoals,
  getAggregateStats,
  getRecentAnalyses,
  closeDb,
} from "./db.js";

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { analyzeChunkBasic, detectGoals, aggregateStats } from "./analyze-basic.js";
import {
  analyzeGoalSequence,
  generateNarrative,
  getGoalSequenceFrames,
} from "./analyze-moments.js";
import { initDb, saveAnalysis } from "./db.js";

/**
 * Run the full tiered analysis pipeline on a video.
 *
 * @param {string} videoPath - Path to video file
 * @param {object} options - Analysis options
 * @param {number} options.fps - Frames per second (default: 1)
 * @param {number} options.chunkSize - Frames per API call (default: 12)
 * @param {string} options.matchId - Unique match ID for database storage
 * @param {boolean} options.saveToDb - Save results to SQLite (default: true)
 * @returns {Promise<object>} Full analysis result
 */
export async function analyzeVideo(videoPath, options = {}) {
  const {
    fps = 1,
    chunkSize = 12,
    matchId = path.basename(videoPath, path.extname(videoPath)),
    saveToDb = true,
    tempDir = "./temp_frames",
  } = options;

  console.log(`\n🎮 Rematch Analyzer (Cost-Optimized)`);
  console.log(`Video: ${videoPath}`);
  console.log(`FPS: ${fps}, Chunk Size: ${chunkSize}`);
  console.log(`Match ID: ${matchId}\n`);

  const client = new Anthropic();

  // 1. Extract frames
  console.log(`📹 Extracting frames at ${fps} fps...`);
  const framePaths = extractFrames(videoPath, fps, tempDir);
  console.log(`   ✓ Extracted ${framePaths.length} frames`);

  // 2. Chunk frames
  const chunks = chunkArray(framePaths, chunkSize);
  console.log(`\n📊 Processing ${chunks.length} chunks with Haiku...`);

  // 3. Basic analysis with Haiku (cheap)
  const basicResults = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const result = await analyzeChunkBasic(client, chunks[i], i, chunks.length);
      basicResults.push({
        chunkIndex: i,
        frameRange: {
          start: path.basename(chunks[i][0]),
          end: path.basename(chunks[i][chunks[i].length - 1]),
        },
        analysis: result,
      });

      // Brief pause to avoid rate limits
      if (i < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (error) {
      console.error(`   ❌ Chunk ${i + 1} failed: ${error.message}`);
      basicResults.push({ chunkIndex: i, error: error.message });
    }
  }

  // 4. Detect goals from basic analysis
  const goals = detectGoals(basicResults);
  console.log(`\n🎯 Detected ${goals.length} goals`);

  // 5. Deep analysis of goals with Sonnet (smart, but only for key moments)
  for (const goal of goals) {
    try {
      // Get frame indices for the goal sequence
      const globalFrameIndex =
        goal.chunkIndex * chunkSize + goal.frameIndex;
      const sequenceFrames = getGoalSequenceFrames(framePaths, globalFrameIndex);

      goal.analysis = await analyzeGoalSequence(client, sequenceFrames, goal);
      console.log(`   ✓ Analyzed goal at ${goal.timestamp}`);
    } catch (error) {
      console.error(`   ❌ Goal analysis failed: ${error.message}`);
    }
  }

  // 6. Aggregate stats
  const stats = aggregateStats(basicResults);
  console.log(`\n📈 Stats: ${stats.events.goals} goals, ${stats.events.passes} passes, ${stats.events.saves} saves`);

  // 7. Generate narrative (one Sonnet call)
  let narrative = null;
  try {
    narrative = await generateNarrative(client, {
      metadata: { videoPath, fps, chunkSize, totalFrames: framePaths.length },
      stats,
      goals,
    });
    console.log(`   ✓ Generated narrative`);
  } catch (error) {
    console.error(`   ❌ Narrative generation failed: ${error.message}`);
  }

  // 8. Compile results
  const result = {
    metadata: {
      videoPath,
      fps,
      chunkSize,
      totalFrames: framePaths.length,
      chunksProcessed: basicResults.length,
      analyzedAt: new Date().toISOString(),
      matchId,
    },
    chunks: basicResults,
    goals,
    stats,
    narrative,
  };

  // 9. Save to database
  if (saveToDb) {
    try {
      initDb();
      const dbId = saveAnalysis(matchId, result);
      console.log(`\n💾 Saved to database (ID: ${dbId})`);
    } catch (error) {
      console.error(`   ❌ Database save failed: ${error.message}`);
    }
  }

  // 10. Cleanup temp frames
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
    console.log(`🧹 Cleaned up temporary frames`);
  }

  // 11. Print summary
  if (narrative) {
    console.log(`\n${"=".repeat(60)}`);
    console.log("📺 MATCH REPORT");
    console.log("=".repeat(60));
    console.log(narrative);
    console.log("=".repeat(60));
  }

  return result;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function extractFrames(videoPath, fps, tempDir) {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  const outputPattern = path.join(tempDir, "frame_%04d.jpg");
  const cmd = `ffmpeg -i "${videoPath}" -vf "fps=${fps}" -q:v 2 "${outputPattern}" -y 2>&1`;

  try {
    execSync(cmd, { stdio: "pipe" });
  } catch {
    // ffmpeg often returns non-zero even on success
  }

  const frames = fs
    .readdirSync(tempDir)
    .filter((f) => f.endsWith(".jpg"))
    .sort();

  if (frames.length === 0) {
    throw new Error("Frame extraction failed - no frames created");
  }

  return frames.map((f) => path.join(tempDir, f));
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
