/**
 * Test script for OCR pipeline.
 * Run with: node packages/ocr/src/test.js
 *
 * Tests against sample clips in C:\Users\mikol\Projects\test-clips\
 */

import path from "path";
import { extractScoreFromVideo } from "./index.js";

const TEST_DIR = "C:\\Users\\mikol\\Projects\\test-clips";

// Expected scores from scores.txt
const EXPECTED = {
  "MedalTVRematch20260124211657404.mp4": { our: 0, opp: 1 },
  "MedalTVRematch20260124212334398.mp4": { our: 0, opp: 1 },
  "MedalTVRematch20260124213035215.mp4": { our: 0, opp: 2 },
  "MedalTVRematch20260120180816608.mp4": { our: 4, opp: 0 },
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
      const result = await extractScoreFromVideo(videoPath, {
        secondsFromEnd: 30, // Last 30 seconds to catch more HUD frames
        fps: 2, // 2 frames per second for more samples
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
