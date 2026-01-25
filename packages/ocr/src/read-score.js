import Tesseract from "tesseract.js";

/**
 * Extract score from OCR text using Rematch HUD format knowledge.
 *
 * Rematch HUD format: "MM:SS  X  Y" where:
 * - MM:SS is the game timer (e.g., "00:00", "02:45")
 * - X is our score (single digit)
 * - Y is opponent score (single digit)
 *
 * The score appears AFTER the timer, so we look for that pattern.
 */
function extractScoreFromText(text) {
  // Normalize whitespace
  const normalized = text.replace(/\s+/g, " ").trim();

  // Pattern 1: Look for timer followed by two single digits
  // "00:00 0 1" or "02:45 3 2"
  const timerScorePattern = /\d{1,2}:\d{2}\s+(\d)\s+(\d)/;
  const timerMatch = normalized.match(timerScorePattern);
  if (timerMatch) {
    return {
      left: parseInt(timerMatch[1], 10),
      right: parseInt(timerMatch[2], 10),
      raw: timerMatch[0],
    };
  }

  // Pattern 2: If no timer found, look for two isolated single digits
  // Must be small numbers (0-6 range typical for game scores)
  const simplePattern = /\b([0-6])\s+([0-6])\b/;
  const simpleMatch = normalized.match(simplePattern);
  if (simpleMatch) {
    return {
      left: parseInt(simpleMatch[1], 10),
      right: parseInt(simpleMatch[2], 10),
      raw: simpleMatch[0],
    };
  }

  // Pattern 3: Look for any two single digits with space (fallback)
  const fallbackPattern = /(?<!\d)(\d)\s+(\d)(?!\d)/;
  const fallbackMatch = normalized.match(fallbackPattern);
  if (fallbackMatch) {
    const left = parseInt(fallbackMatch[1], 10);
    const right = parseInt(fallbackMatch[2], 10);
    // Only accept if both are small enough to be game scores
    if (left <= 9 && right <= 9) {
      return { left, right, raw: fallbackMatch[0] };
    }
  }

  return null;
}

/**
 * Determine confidence level based on Tesseract confidence score.
 */
function getConfidenceLevel(tesseractConfidence) {
  if (tesseractConfidence >= 90) return "high";
  if (tesseractConfidence >= 70) return "medium";
  return "low";
}

/**
 * Process a single frame with OCR.
 * Uses optimized settings for reading game HUD text.
 */
async function processFrame(framePath, worker) {
  const {
    data: { text, confidence },
  } = await worker.recognize(framePath);

  const scoreMatch = extractScoreFromText(text);

  return {
    frame: framePath,
    text: text.trim(),
    confidence: confidence,
    scoreMatch,
  };
}

/**
 * Find the most common score across all candidates using voting.
 * Returns the score that appears most frequently.
 */
function findConsensusScore(candidates) {
  const scoreCounts = new Map();

  for (const c of candidates) {
    if (c.scoreMatch) {
      const key = `${c.scoreMatch.left}-${c.scoreMatch.right}`;
      const current = scoreCounts.get(key) || { count: 0, bestConfidence: 0, candidate: null };
      current.count++;
      if (c.confidence > current.bestConfidence) {
        current.bestConfidence = c.confidence;
        current.candidate = c;
      }
      scoreCounts.set(key, current);
    }
  }

  if (scoreCounts.size === 0) return null;

  // Find score with most votes
  let best = null;
  let bestCount = 0;
  for (const [key, data] of scoreCounts) {
    if (data.count > bestCount) {
      bestCount = data.count;
      best = data;
    }
  }

  return best?.candidate || null;
}

/**
 * Read match score from an array of frame images.
 *
 * @param {string[]} framePaths - Array of paths to frame images
 * @returns {Promise<ScoreResult>} The best score extraction result
 *
 * @typedef {object} ScoreResult
 * @property {number|null} our_goals - Goals scored by our team (left side)
 * @property {number|null} opp_goals - Goals scored by opponent (right side)
 * @property {'high'|'medium'|'low'|'failed'} confidence - Confidence level
 * @property {string} raw_text - Raw OCR text from the best frame
 * @property {string} frame_used - Path to the frame that produced the result
 * @property {Array} all_candidates - All frames processed with their results
 */
export async function readScore(framePaths) {
  if (!framePaths || framePaths.length === 0) {
    return {
      our_goals: null,
      opp_goals: null,
      confidence: "failed",
      raw_text: "",
      frame_used: "",
      all_candidates: [],
    };
  }

  console.log(`[read-score] processing ${framePaths.length} frames...`);

  // Create Tesseract worker with optimized settings for HUD text
  const worker = await Tesseract.createWorker("eng");

  const allCandidates = [];
  const processedFrames = [];

  try {
    for (const framePath of framePaths) {
      const result = await processFrame(framePath, worker);

      allCandidates.push({
        frame: result.frame,
        text: result.text.substring(0, 200), // Truncate for readability
        score_match: result.scoreMatch ? result.scoreMatch.raw : null,
        confidence: result.confidence,
      });

      if (result.scoreMatch) {
        processedFrames.push(result);
      }
    }
  } finally {
    await worker.terminate();
  }

  // Use voting to find consensus score (most common across frames)
  const bestResult = findConsensusScore(processedFrames);

  // If we found a score via voting, return it
  if (bestResult && bestResult.scoreMatch) {
    const voteCount = processedFrames.filter(
      (f) =>
        f.scoreMatch.left === bestResult.scoreMatch.left &&
        f.scoreMatch.right === bestResult.scoreMatch.right
    ).length;

    console.log(
      `[read-score] found score: ${bestResult.scoreMatch.left}-${bestResult.scoreMatch.right} ` +
        `(confidence: ${bestResult.confidence.toFixed(1)}%, votes: ${voteCount}/${processedFrames.length})`
    );

    return {
      our_goals: bestResult.scoreMatch.left,
      opp_goals: bestResult.scoreMatch.right,
      confidence: getConfidenceLevel(bestResult.confidence),
      raw_text: bestResult.text,
      frame_used: bestResult.frame,
      all_candidates: allCandidates,
    };
  }

  // No score found
  console.log("[read-score] no score pattern found in any frame");

  return {
    our_goals: null,
    opp_goals: null,
    confidence: "failed",
    raw_text: allCandidates[0]?.text || "",
    frame_used: allCandidates[0]?.frame || "",
    all_candidates: allCandidates,
  };
}
