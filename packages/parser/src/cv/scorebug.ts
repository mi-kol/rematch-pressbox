/**
 * Scorebug extraction and parsing.
 *
 * Extracts:
 * - Team colors from swatches (critical for minimap classification)
 * - Game time
 * - Score
 */

import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import type { ScorebugData, HSVColor, RGBColor } from '../types.js';
import type { ResolutionConfig } from '../config.js';
import { rgbToHsv, findDominantColor } from './colors.js';

// === Score temporal filtering ===

const SCORE_WINDOW_SIZE = 7;
const SCORE_MIN_AGREEMENT = 4;
const TIME_WINDOW_SIZE = 5;
const TIME_MIN_AGREEMENT = 3;
const MAX_SCORE_PER_TEAM = 15;

export interface ScoreFilterState {
  scoreHistory: Array<{ ours: number; opp: number }>;
  timeHistory: Array<{ time: string; seconds: number }>;
  acceptedScore: { ours: number; opp: number };
  acceptedTime: { time: string; seconds: number };
  worker: Tesseract.Worker | null;
}

export function createScoreFilterState(): ScoreFilterState {
  return {
    scoreHistory: [],
    timeHistory: [],
    acceptedScore: { ours: 0, opp: 0 },
    acceptedTime: { time: '00:00', seconds: 0 },
    worker: null,
  };
}

export async function initScoreWorker(state: ScoreFilterState): Promise<void> {
  state.worker = await Tesseract.createWorker('eng');
  await state.worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    tessedit_char_whitelist: '0123456789: ',
  });
}

export async function terminateScoreWorker(state: ScoreFilterState): Promise<void> {
  if (state.worker) {
    await state.worker.terminate();
    state.worker = null;
  }
}

/**
 * Apply sliding-window majority vote + monotonicity to raw score/time readings.
 */
export function filterScoreReading(
  state: ScoreFilterState,
  raw: { ours: number; opp: number; time: string; seconds: number }
): { ours: number; opp: number; time: string; seconds: number } {
  // --- Score filtering ---
  state.scoreHistory.push({ ours: raw.ours, opp: raw.opp });
  if (state.scoreHistory.length > SCORE_WINDOW_SIZE) {
    state.scoreHistory.shift();
  }

  // Majority vote on (ours, opp) pairs
  const scoreCounts = new Map<string, number>();
  for (const s of state.scoreHistory) {
    const key = `${s.ours},${s.opp}`;
    scoreCounts.set(key, (scoreCounts.get(key) || 0) + 1);
  }

  let bestScoreKey = `${state.acceptedScore.ours},${state.acceptedScore.opp}`;
  let bestScoreCount = 0;
  for (const [key, count] of scoreCounts) {
    if (count > bestScoreCount) {
      bestScoreCount = count;
      bestScoreKey = key;
    }
  }

  if (bestScoreCount >= SCORE_MIN_AGREEMENT) {
    const [votedOurs, votedOpp] = bestScoreKey.split(',').map(Number);

    // Sanity: reject scores above cap
    if (votedOurs <= MAX_SCORE_PER_TEAM && votedOpp <= MAX_SCORE_PER_TEAM) {
      // Monotonicity: score can only increase
      if (votedOurs >= state.acceptedScore.ours && votedOpp >= state.acceptedScore.opp) {
        // Increment-by-1: reject jumps > 1 unless very strong consensus (6/7)
        const ourDelta = votedOurs - state.acceptedScore.ours;
        const oppDelta = votedOpp - state.acceptedScore.opp;
        if ((ourDelta <= 1 && oppDelta <= 1) || bestScoreCount >= SCORE_WINDOW_SIZE - 1) {
          state.acceptedScore = { ours: votedOurs, opp: votedOpp };
        }
      }
    }
  }

  // --- Time filtering ---
  state.timeHistory.push({ time: raw.time, seconds: raw.seconds });
  if (state.timeHistory.length > TIME_WINDOW_SIZE) {
    state.timeHistory.shift();
  }

  const timeCounts = new Map<string, number>();
  for (const t of state.timeHistory) {
    timeCounts.set(t.time, (timeCounts.get(t.time) || 0) + 1);
  }

  let bestTimeKey = state.acceptedTime.time;
  let bestTimeCount = 0;
  for (const [key, count] of timeCounts) {
    if (count > bestTimeCount) {
      bestTimeCount = count;
      bestTimeKey = key;
    }
  }

  if (bestTimeCount >= TIME_MIN_AGREEMENT) {
    const votedSeconds = parseTimeToSeconds(bestTimeKey);
    // Time should monotonically decrease (countdown) or stay same
    // Accept "00:00" only if we were already below 5 seconds
    if (bestTimeKey === '00:00' && state.acceptedTime.seconds > 5) {
      // Reject — likely OCR noise
    } else if (votedSeconds <= state.acceptedTime.seconds || state.acceptedTime.seconds === 0) {
      state.acceptedTime = { time: bestTimeKey, seconds: votedSeconds };
    }
  }

  return { ...state.acceptedScore, ...state.acceptedTime };
}

/**
 * Extract team colors and score data from a frame's scorebug.
 */
export async function extractScorebugColors(
  framePath: string,
  config: ResolutionConfig,
  filterState?: ScoreFilterState
): Promise<ScorebugData> {
  const { scorebug } = config;

  // Extract the full scorebug region
  const scorebugImage = sharp(framePath).extract({
    left: scorebug.x,
    top: scorebug.y,
    width: scorebug.width,
    height: scorebug.height,
  });

  // Get raw pixel data
  const { data: pixels, info } = await scorebugImage
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;

  // Extract team color swatches
  const ourSwatchColor = extractSwatchColor(
    pixels,
    width,
    height,
    channels,
    scorebug.ourSwatchX - scorebug.x,
    scorebug.swatchY - scorebug.y,
    scorebug.ourSwatchWidth,
    scorebug.swatchHeight
  );

  const oppSwatchColor = extractSwatchColor(
    pixels,
    width,
    height,
    channels,
    scorebug.oppSwatchX - scorebug.x,
    scorebug.swatchY - scorebug.y,
    scorebug.oppSwatchWidth,
    scorebug.swatchHeight
  );

  // Extract time and score via OCR
  const ocrResult = await extractTimeAndScore(framePath, config, filterState?.worker);

  // Apply temporal filtering if filter state is available
  let time = ocrResult.time;
  let timeSeconds = parseTimeToSeconds(ocrResult.time);
  let ourScore = ocrResult.ourScore;
  let oppScore = ocrResult.oppScore;

  if (filterState) {
    const filtered = filterScoreReading(filterState, {
      ours: ocrResult.ourScore,
      opp: ocrResult.oppScore,
      time: ocrResult.time,
      seconds: parseTimeToSeconds(ocrResult.time),
    });
    time = filtered.time;
    timeSeconds = filtered.seconds;
    ourScore = filtered.ours;
    oppScore = filtered.opp;
  }

  return {
    timeRemaining: time,
    timeRemainingSeconds: timeSeconds,
    scoreOurs: ourScore,
    scoreOpponent: oppScore,
    ourTeamColor: ourSwatchColor,
    oppTeamColor: oppSwatchColor,
    confidence: ocrResult.confidence,
  };
}

/**
 * Extract the dominant color from a swatch region.
 */
function extractSwatchColor(
  pixels: Buffer,
  imageWidth: number,
  imageHeight: number,
  channels: number,
  swatchX: number,
  swatchY: number,
  swatchWidth: number,
  swatchHeight: number
): HSVColor {
  // Clamp coordinates to image bounds
  const x1 = Math.max(0, Math.min(swatchX, imageWidth - 1));
  const y1 = Math.max(0, Math.min(swatchY, imageHeight - 1));
  const x2 = Math.max(0, Math.min(swatchX + swatchWidth, imageWidth));
  const y2 = Math.max(0, Math.min(swatchY + swatchHeight, imageHeight));

  const regionWidth = x2 - x1;
  const regionHeight = y2 - y1;

  if (regionWidth <= 0 || regionHeight <= 0) {
    return { h: 0, s: 0, v: 0 };
  }

  // Extract pixels from the swatch region
  const swatchPixels = Buffer.alloc(regionWidth * regionHeight * channels);
  let writeIdx = 0;

  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const readIdx = (y * imageWidth + x) * channels;
      for (let c = 0; c < channels; c++) {
        swatchPixels[writeIdx++] = pixels[readIdx + c];
      }
    }
  }

  return findDominantColor(swatchPixels, regionWidth, regionHeight, channels);
}

/**
 * Extract time and score using OCR.
 */
async function extractTimeAndScore(
  framePath: string,
  config: ResolutionConfig,
  existingWorker?: Tesseract.Worker | null
): Promise<{
  time: string;
  ourScore: number;
  oppScore: number;
  confidence: number;
}> {
  const { scorebug } = config;

  // Crop and preprocess the scorebug for OCR
  const processedBuffer = await sharp(framePath)
    .extract({
      left: scorebug.x,
      top: scorebug.y,
      width: scorebug.width,
      height: scorebug.height,
    })
    // Scale up for better OCR
    .resize(scorebug.width * 3, scorebug.height * 3, {
      kernel: sharp.kernel.lanczos3,
    })
    // Convert to grayscale
    .grayscale()
    // Increase contrast
    .normalize()
    .toBuffer();

  // Run OCR (reuse existing worker if provided)
  const worker = existingWorker ?? await Tesseract.createWorker('eng');

  if (!existingWorker) {
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
      tessedit_char_whitelist: '0123456789: ',
    });
  }

  const { data } = await worker.recognize(processedBuffer);

  if (!existingWorker) {
    await worker.terminate();
  }

  // Parse the OCR result
  const parsed = parseOcrText(data.text);

  return {
    time: parsed.time,
    ourScore: parsed.ourScore,
    oppScore: parsed.oppScore,
    confidence: data.confidence / 100,
  };
}

/**
 * Parse OCR text to extract time and score.
 */
function parseOcrText(text: string): {
  time: string;
  ourScore: number;
  oppScore: number;
} {
  // Normalize whitespace
  const normalized = text.replace(/\s+/g, ' ').trim();

  // Default values
  let time = '00:00';
  let ourScore = 0;
  let oppScore = 0;

  // Pattern: "MM:SS X Y" where X and Y are single digits
  const fullPattern = /(\d{1,2}:\d{2})\s+(\d)\s+(\d)/;
  const fullMatch = normalized.match(fullPattern);

  if (fullMatch) {
    time = fullMatch[1];
    ourScore = parseInt(fullMatch[2], 10);
    oppScore = parseInt(fullMatch[3], 10);
  } else {
    // Try to find just the time
    const timePattern = /(\d{1,2}:\d{2})/;
    const timeMatch = normalized.match(timePattern);
    if (timeMatch) {
      time = timeMatch[1];
    }

    // Try to find two digits for score
    const scorePattern = /\b(\d)\s+(\d)\b/;
    const scoreMatch = normalized.match(scorePattern);
    if (scoreMatch) {
      ourScore = parseInt(scoreMatch[1], 10);
      oppScore = parseInt(scoreMatch[2], 10);
    }
  }

  return { time, ourScore, oppScore };
}

/**
 * Convert time string "MM:SS" to seconds.
 */
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length !== 2) return 0;

  const minutes = parseInt(parts[0], 10) || 0;
  const seconds = parseInt(parts[1], 10) || 0;

  return minutes * 60 + seconds;
}

/**
 * Debug function to save swatch regions for inspection.
 */
export async function debugSaveSwatchRegions(
  framePath: string,
  config: ResolutionConfig,
  outputDir: string
): Promise<void> {
  const { scorebug } = config;
  const path = await import('path');
  const fs = await import('fs/promises');

  await fs.mkdir(outputDir, { recursive: true });

  // Save full scorebug
  await sharp(framePath)
    .extract({
      left: scorebug.x,
      top: scorebug.y,
      width: scorebug.width,
      height: scorebug.height,
    })
    .toFile(path.join(outputDir, 'scorebug_full.png'));

  // Save our team swatch region
  await sharp(framePath)
    .extract({
      left: scorebug.ourSwatchX,
      top: scorebug.swatchY,
      width: scorebug.ourSwatchWidth,
      height: scorebug.swatchHeight,
    })
    .toFile(path.join(outputDir, 'swatch_ours.png'));

  // Save opponent swatch region
  await sharp(framePath)
    .extract({
      left: scorebug.oppSwatchX,
      top: scorebug.swatchY,
      width: scorebug.oppSwatchWidth,
      height: scorebug.swatchHeight,
    })
    .toFile(path.join(outputDir, 'swatch_opponent.png'));

  console.log(`[scorebug] Debug images saved to ${outputDir}`);
}

// CLI test entry point
if (process.argv[1] && process.argv[1].includes('scorebug')) {
  const testFrame = process.argv[2];
  if (!testFrame) {
    console.log('Usage: node scorebug.js <frame_path>');
    process.exit(1);
  }

  const { CONFIG_1080P } = await import('../config.js');

  console.log('Testing scorebug extraction on:', testFrame);

  try {
    // Save debug images
    await debugSaveSwatchRegions(testFrame, CONFIG_1080P, './output/debug');

    // Extract colors
    const result = await extractScorebugColors(testFrame, CONFIG_1080P);

    console.log('\nExtraction Results:');
    console.log('-------------------');
    console.log('Time:', result.timeRemaining, `(${result.timeRemainingSeconds}s)`);
    console.log('Score:', result.scoreOurs, '-', result.scoreOpponent);
    console.log('Our Team Color (HSV):', result.ourTeamColor);
    console.log('Opp Team Color (HSV):', result.oppTeamColor);
    console.log('Confidence:', (result.confidence * 100).toFixed(1) + '%');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}
