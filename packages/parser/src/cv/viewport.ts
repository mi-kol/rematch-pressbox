/**
 * Viewport (3D scene) analysis.
 *
 * - Detects nametags for player identification
 * - Detects pass/shot indicators
 * - Detects ball contact range indicator
 *
 * Nametag detection: text-first approach.
 *   1. Scan upper 60% of frame for clusters of white pixels (text)
 *   2. Group clusters into text blocks, filter by nametag dimensions
 *   3. Classify team from non-white (background) pixels using protoDist
 *   4. OCR each validated candidate with Tesseract
 *
 * This works even when nametag backgrounds are semi-transparent overlays
 * that don't exactly match the team's scorebug color.
 */

import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import type { PlayerAction, Vector2, HSVColor } from '../types.js';
import type { ResolutionConfig } from '../config.js';
import { rgbToHsv } from './colors.js';

export interface ViewportIndicator {
  type: 'pass_target' | 'shot_charging' | 'ball_contact_range' | 'queued_pass' | 'lob_indicator';
  position?: Vector2;
  value?: number;
}

export interface NametagDetection {
  text: string;
  confidence: number;
  screenPosition: { x: number; y: number };  // Pixel coords in original frame
  team: 'our_team' | 'opp_team' | 'unknown';
}

// --- Detection constants (1080p reference) ---

const NAMETAG_MIN_W = 30;
const NAMETAG_MAX_W = 200;
const NAMETAG_MIN_H = 5;
const NAMETAG_MAX_H = 25;
/** Bridge inter-character white pixel gaps up to this many pixels. */
const WHITE_GAP_BRIDGE = 8;
/** Allow this many blank rows within a text block. */
const ROW_GAP_TOLERANCE = 2;
/** Minimum white run length to consider. */
const MIN_WHITE_RUN = 15;
/** Maximum nametag candidates to OCR per frame. */
const MAX_OCR_CANDIDATES = 8;
/** Maximum protoDist for team classification. */
const TEAM_CLASSIFY_THRESHOLD = 60;
/** Minimum margin between team distances. */
const TEAM_CLASSIFY_MARGIN = 8;
/** Common game UI words that should not be treated as player names. */
const NAMETAG_BLOCKLIST = new Set([
  'back', 'rule', 'good', 'goal', 'assist', 'save', 'interception',
  'pass', 'shot', 'tackle', 'slide', 'jab', 'dive', 'header',
  'ping', 'home', 'away', 'score', 'rematch', 'overtime',
  'halftime', 'kickoff', 'loading', 'replay', 'ready',
  'boost', 'sprint', 'effort', 'extra', 'queue', 'cancel',
  'nice', 'great', 'wow', 'what', 'the', 'play',
  'press', 'start', 'menu', 'exit', 'settings', 'match',
  'here', 'metre', 'post', 'fact', 'fay', 'vou',
  'got this', 'has scored',
]);

// --- Internal types ---

interface WhiteRun {
  y: number;
  startX: number;
  endX: number;
  whitePixelCount: number;
}

interface TextBlock {
  minX: number; maxX: number;
  minY: number; maxY: number;
}

// ========================================================
// Nametag detection (text-first)
// ========================================================

/**
 * Detect and OCR nametags in the viewport.
 *
 * Uses a text-first approach: find white text clusters, group into blocks,
 * validate dimensions, classify team from background, then OCR.
 */
export async function detectNametags(
  framePath: string,
  config: ResolutionConfig,
  teamColors?: { ours: HSVColor; opponent: HSVColor },
): Promise<NametagDetection[]> {
  if (!teamColors) return [];

  // Scan region: y=100 (below scorebug) to 65% of frame height
  const scanTop = 100;
  const scanHeight = Math.round(config.height * 0.65) - scanTop;

  const { data, info } = await sharp(framePath)
    .extract({ left: 0, top: scanTop, width: config.width, height: scanHeight })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;

  // Step 1: Find white text runs per row
  const allRuns: WhiteRun[] = [];
  for (let y = 0; y < height; y++) {
    findWhiteRuns(data, y, width, channels, allRuns);
  }

  if (allRuns.length === 0) return [];

  // Step 2: Group into text blocks
  const blocks = groupRunsToBlocks(allRuns);

  // Step 3: Filter by nametag dimensions
  const candidates = blocks.filter(b => {
    const w = b.maxX - b.minX + 1;
    const h = b.maxY - b.minY + 1;
    return w >= NAMETAG_MIN_W && w <= NAMETAG_MAX_W &&
           h >= NAMETAG_MIN_H && h <= NAMETAG_MAX_H &&
           w / h >= 1.5;
  });

  if (candidates.length === 0) return [];

  // Step 4: Exclude HUD regions
  const filtered = candidates.filter(b => {
    const origY = scanTop + (b.minY + b.maxY) / 2;
    // Exclude top-right debug overlay area
    if (b.minX > config.width * 0.68 && origY < config.height * 0.35) return false;
    // Exclude minimap area (bottom-right)
    const mm = config.minimap;
    if (b.minX > mm.centerX - mm.radius - 50 && origY > mm.centerY - mm.radius - 50) return false;
    return true;
  });

  if (filtered.length === 0) return [];

  // Step 5: Classify team + sort by size, cap candidates
  const classified = filtered.map(block => ({
    block,
    team: classifyBlockTeam(data, width, height, channels, block, teamColors),
  }));

  // De-duplicate overlapping blocks (keep the larger one)
  const deduped = deduplicateBlocks(classified);

  deduped.sort((a, b) => {
    const areaA = (a.block.maxX - a.block.minX + 1) * (a.block.maxY - a.block.minY + 1);
    const areaB = (b.block.maxX - b.block.minX + 1) * (b.block.maxY - b.block.minY + 1);
    return areaB - areaA;
  });
  const toOCR = deduped.slice(0, MAX_OCR_CANDIDATES);

  // Step 6: OCR each candidate
  const detections: NametagDetection[] = [];
  let worker: Tesseract.Worker | null = null;

  try {
    worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });

    for (const { block, team } of toOCR) {
      const result = await ocrNametag(framePath, block, scanTop, config, worker);
      if (result) {
        detections.push({
          text: result.text,
          confidence: result.confidence,
          screenPosition: {
            x: Math.round((block.minX + block.maxX) / 2),
            y: Math.round(scanTop + (block.minY + block.maxY) / 2),
          },
          team,
        });
      }
    }
  } finally {
    if (worker) await worker.terminate();
  }

  return detections;
}

// ========================================================
// White text scanning
// ========================================================

/**
 * Find horizontal runs of white pixels in a row.
 * Bridges small gaps (character spacing).
 */
function findWhiteRuns(
  data: Buffer,
  y: number,
  width: number,
  channels: number,
  out: WhiteRun[],
): void {
  const rowBase = y * width * channels;

  let start = -1;
  let lastWhiteX = -1;
  let count = 0;

  for (let x = 0; x < width; x++) {
    const off = rowBase + x * channels;
    const r = data[off], g = data[off + 1], b = data[off + 2];
    const isWhite = r > 180 && g > 180 && b > 180;

    if (isWhite) {
      if (start < 0) {
        start = x;
        count = 0;
      } else if (x - lastWhiteX > WHITE_GAP_BRIDGE) {
        // Gap too large — emit run, start new one
        if (lastWhiteX - start + 1 >= MIN_WHITE_RUN) {
          out.push({ y, startX: start, endX: lastWhiteX, whitePixelCount: count });
        }
        start = x;
        count = 0;
      }
      count++;
      lastWhiteX = x;
    }
  }

  if (start >= 0 && lastWhiteX >= 0 && lastWhiteX - start + 1 >= MIN_WHITE_RUN) {
    out.push({ y, startX: start, endX: lastWhiteX, whitePixelCount: count });
  }
}

// ========================================================
// Text block grouping
// ========================================================

/**
 * Group vertically adjacent, horizontally overlapping white runs into text blocks.
 */
function groupRunsToBlocks(runs: WhiteRun[]): TextBlock[] {
  runs.sort((a, b) => a.y - b.y || a.startX - b.startX);

  const active: TextBlock[] = [];
  const finished: TextBlock[] = [];

  for (const run of runs) {
    let matched = false;

    for (const block of active) {
      if (run.y > block.maxY &&
          run.y - block.maxY <= ROW_GAP_TOLERANCE + 1 &&
          rangesOverlap(block.minX, block.maxX, run.startX, run.endX)) {
        block.maxY = run.y;
        block.minX = Math.min(block.minX, run.startX);
        block.maxX = Math.max(block.maxX, run.endX);
        matched = true;
        break;
      }
    }

    if (!matched) {
      active.push({
        minX: run.startX, maxX: run.endX,
        minY: run.y, maxY: run.y,
      });
    }

    // Prune stale blocks
    for (let i = active.length - 1; i >= 0; i--) {
      if (run.y - active[i].maxY > ROW_GAP_TOLERANCE + 1) {
        finished.push(active[i]);
        active.splice(i, 1);
      }
    }
  }

  finished.push(...active);
  return finished;
}

/** Check if two ranges overlap (with 6px tolerance for text alignment). */
function rangesOverlap(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin <= bMax + 6 && bMin <= aMax + 6;
}

// ========================================================
// De-duplication
// ========================================================

/**
 * Remove overlapping text blocks. When two blocks overlap significantly,
 * keep only the larger one. This prevents OCR-ing the same nametag twice.
 */
function deduplicateBlocks<T extends { block: TextBlock }>(items: T[]): T[] {
  const keep = new Array(items.length).fill(true);

  for (let i = 0; i < items.length; i++) {
    if (!keep[i]) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (!keep[j]) continue;

      const a = items[i].block;
      const b = items[j].block;

      // Check horizontal overlap
      const overlapX = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) + 1);
      const minW = Math.min(a.maxX - a.minX + 1, b.maxX - b.minX + 1);

      if (overlapX > minW * 0.5) {
        // Check vertical overlap
        const overlapY = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) + 1);
        const minH = Math.min(a.maxY - a.minY + 1, b.maxY - b.minY + 1);

        if (overlapY > minH * 0.5) {
          // Overlapping — remove the smaller one
          const areaA = (a.maxX - a.minX + 1) * (a.maxY - a.minY + 1);
          const areaB = (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1);
          keep[areaA >= areaB ? j : i] = false;
        }
      }
    }
  }

  return items.filter((_, i) => keep[i]);
}

// ========================================================
// Team classification
// ========================================================

/**
 * Classify which team a nametag belongs to based on its non-white background pixels.
 *
 * Nametag backgrounds are semi-transparent colored overlays. We sample
 * the non-white, non-dark pixels and compare their average color to both
 * team colors using protoDist.
 */
function classifyBlockTeam(
  data: Buffer,
  imageWidth: number,
  imageHeight: number,
  channels: number,
  block: TextBlock,
  teamColors: { ours: HSVColor; opponent: HSVColor },
): 'our_team' | 'opp_team' | 'unknown' {
  const expand = 4;
  const x1 = Math.max(0, block.minX - expand);
  const y1 = Math.max(0, block.minY - expand);
  const x2 = Math.min(imageWidth - 1, block.maxX + expand);
  const y2 = Math.min(imageHeight - 1, block.maxY + expand);

  let sumH = 0, sumS = 0, sumV = 0, count = 0;

  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const off = (y * imageWidth + x) * channels;
      const r = data[off], g = data[off + 1], b = data[off + 2];

      // Skip white pixels (text)
      if (r > 180 && g > 180 && b > 180) continue;
      // Skip very dark pixels (shadows)
      if (r < 20 && g < 20 && b < 20) continue;

      const hsv = rgbToHsv({ r, g, b });

      // For low-saturation pixels: they ARE a signal if one team is gray
      if (hsv.s < 10) {
        if (teamColors.ours.s < 15 || teamColors.opponent.s < 15) {
          // One team is gray — low-sat pixels carry team information
          sumH += hsv.h;
          sumS += hsv.s;
          sumV += hsv.v;
          count++;
        }
        continue;
      }

      sumH += hsv.h;
      sumS += hsv.s;
      sumV += hsv.v;
      count++;
    }
  }

  if (count < 5) return 'unknown';

  const avgColor: HSVColor = { h: sumH / count, s: sumS / count, v: sumV / count };

  const dOur = protoDist(avgColor, teamColors.ours);
  const dOpp = protoDist(avgColor, teamColors.opponent);
  const minD = Math.min(dOur, dOpp);
  const margin = Math.abs(dOur - dOpp);

  if (minD < TEAM_CLASSIFY_THRESHOLD && margin > TEAM_CLASSIFY_MARGIN) {
    return dOur <= dOpp ? 'our_team' : 'opp_team';
  }

  return 'unknown';
}

/**
 * Perceptual color distance for prototype matching.
 * Weights hue by minimum saturation (grays have meaningless hue).
 */
function protoDist(a: HSVColor, b: HSVColor): number {
  let dh = Math.abs(a.h - b.h);
  if (dh > 180) dh = 360 - dh;
  const hueWeight = Math.min(a.s, b.s) / 100;
  const ds = Math.abs(a.s - b.s);
  const dv = Math.abs(a.v - b.v);
  return (dh / 1.8) * hueWeight + ds * 0.4 + dv * 0.6;
}

// ========================================================
// OCR
// ========================================================

/**
 * OCR a single nametag text block.
 * Crops the region with padding, scales up 3x, normalizes, negates.
 */
async function ocrNametag(
  framePath: string,
  block: TextBlock,
  scanTopOffset: number,
  config: ResolutionConfig,
  worker: Tesseract.Worker,
): Promise<{ text: string; confidence: number } | null> {
  const pad = 6;
  const left = Math.max(0, block.minX - pad);
  const top = Math.max(0, block.minY + scanTopOffset - pad);
  const w = Math.min(config.width - left, block.maxX - block.minX + 1 + pad * 2);
  const h = Math.min(config.height - top, block.maxY - block.minY + 1 + pad * 2);

  if (w < 10 || h < 4) return null;

  const processed = await sharp(framePath)
    .extract({ left, top, width: w, height: h })
    .resize(w * 3, h * 3, { kernel: sharp.kernel.lanczos3 })
    .grayscale()
    .normalize()
    .negate()
    .toBuffer();

  const { data } = await worker.recognize(processed);
  const text = data.text.trim().replace(/[^a-zA-Z0-9_ .-]/g, '').trim();
  const confidence = data.confidence / 100;

  // Require at least 3 characters and reasonable OCR confidence
  if (text.length < 3 || confidence < 0.40) return null;

  // Reject game UI words
  if (NAMETAG_BLOCKLIST.has(text.toLowerCase())) return null;

  return { text, confidence };
}

// ========================================================
// Viewport indicators (stub — Iteration 8)
// ========================================================

/**
 * Detect viewport indicators in a frame.
 * TODO: Implement in Iteration 8
 */
export async function detectViewportIndicators(
  _framePath: string,
  _config: ResolutionConfig
): Promise<ViewportIndicator[]> {
  return [];
}

/**
 * Detect POV player's queued action from viewport indicators.
 */
export function detectQueuedAction(
  indicators: ViewportIndicator[]
): PlayerAction | null {
  if (indicators.some(i => i.type === 'queued_pass')) {
    return 'queued_input';
  }

  const shotIndicator = indicators.find(i => i.type === 'shot_charging');
  if (shotIndicator) {
    return 'charging_shot';
  }

  return null;
}
