/**
 * Test script for OCR pipeline.
 * Run with: node packages/ocr/src/test.js
 *
 * Tests against sample clips in C:\Users\mikol\Projects\test-clips\
 */

import path from "path";
import fs from "fs/promises";
import { extractScoreFromVideo } from "./index.js";

const TEST_DIR = "C:\\Users\\mikol\\Projects\\test-clips";
const DEBUG_DIR = "C:\\Users\\mikol\\Projects\\test-clips\\debug-frames";

// Set to true to save extracted frames for inspection
const DEBUG_MODE = true;

// Expected scores from scores.txt
const EXPECTED = {
  "MedalTVRematch20260124211657404.mp4": { our: 0, opp: 1 },
  "MedalTVRematch20260124212334398.mp4": { our: 0, opp: 1 },
  "MedalTVRematch20260124213035215.mp4": { our: 0, opp: 2 },
  "MedalTVRematch20260120180816608.mp4": { our: 4, opp: 0 },
  "MedalTVRematch20260201170928075.mp4": { our: 1, opp: 2 },
  "MedalTVRematch20260201165834067.mp4": { our: 3, opp: 1 }
};

async function runTests() {
  console.log("=".repeat(60));
  console.log("OCR Pipeline Test");
  console.log("=".repeat(60));
  console.log();

  let passed = 0;
  let failed = 0;

  for (const [filename, expected] of Object.entries(EXPECTED)) {
    const videoPath = path.join(TEST_DIR, filename);
    console.log(`Testing: ${filename}`);
    console.log(`Expected: ${expected.our}-${expected.opp}`);

    try {
      // In debug mode, save frames for inspection
      const debugOutputDir = DEBUG_MODE
        ? path.join(DEBUG_DIR, path.basename(filename, ".mp4"))
        : undefined;

      if (DEBUG_MODE && debugOutputDir) {
        await fs.mkdir(debugOutputDir, { recursive: true });
      }

      const result = await extractScoreFromVideo(videoPath, {
        secondsFromEnd: 30, // Last 30 seconds to catch more HUD frames
        fps: 2, // 2 frames per second for more samples
        keepFrames: DEBUG_MODE,
        outputDir: debugOutputDir,
      });

      const actual = `${result.our_goals}-${result.opp_goals}`;
      const expectedStr = `${expected.our}-${expected.opp}`;

      if (result.our_goals === expected.our && result.opp_goals === expected.opp) {
        console.log(`Result: ${actual} (confidence: ${result.confidence})`);
        console.log(`Status: PASS`);
        passed++;
      } else {
        console.log(`Result: ${actual} (confidence: ${result.confidence})`);
        console.log(`Status: FAIL (expected ${expectedStr})`);
        console.log(`Raw text: ${result.raw_text.substring(0, 100)}...`);
        // Show all detected scores for debugging
        if (DEBUG_MODE && result.all_candidates) {
          console.log(`\nAll candidates with score matches:`);
          const withScores = result.all_candidates.filter((c) => c.score_match);
          const timerMatches = withScores.filter((c) => c.has_timer);
          const plainMatches = withScores.filter((c) => !c.has_timer);
          console.log(`  Timer matches (${timerMatches.length}):`);
          for (const c of timerMatches.slice(0, 5)) {
            console.log(`    - "${c.score_match}" (conf: ${c.confidence.toFixed(1)}%)`);
          }
          console.log(`  Plain matches (${plainMatches.length}):`);
          for (const c of plainMatches.slice(0, 3)) {
            console.log(`    - "${c.score_match}" (conf: ${c.confidence.toFixed(1)}%)`);
          }
          if (withScores.length === 0) {
            console.log(`  (no score patterns found)`);
            console.log(`  Sample raw texts:`);
            for (const c of result.all_candidates.slice(0, 3)) {
              console.log(`    "${c.text.substring(0, 80)}..."`);
            }
          }
        }
        if (DEBUG_MODE) {
          console.log(`Frames saved to: ${path.join(DEBUG_DIR, path.basename(filename, ".mp4"))}`);
        }
        failed++;
      }
    } catch (err) {
      console.log(`Status: ERROR - ${err.message}`);
      failed++;
    }

    console.log("-".repeat(60));
  }

  console.log();
  console.log("=".repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
