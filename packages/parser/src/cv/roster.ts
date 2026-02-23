/**
 * Roster screen detection and OCR.
 *
 * The roster screen appears during the pre-game intro (~5-10s) and shows
 * player names for both teams in a left/right layout:
 *   HOME (left side) — 5 player name cards
 *   AWAY (right side) — 5 player name cards
 *
 * Detection: check minimap region variance — roster screen has no minimap.
 * OCR: extract each name card at known positions, OCR individually.
 */

import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import type { ResolutionConfig } from '../config.js';
import type { RosterScreenData, RosterEntry } from '../types.js';

/** Minimum number of names to consider a valid roster detection */
const MIN_ROSTER_NAMES = 3;

/**
 * Detection regions (ratios of 1920x1080 reference resolution).
 * HOME label: bright colored swatch + "HOME" text — avg brightness ~206 on true roster, ~100 on stats
 * AWAY card1: first AWAY player card — avg brightness ~62 on true roster, ~90-110 on stats/gameplay
 */
const DETECT_HOME_LABEL = { x: 255 / 1920, y: 200 / 1080, w: 85 / 1920, h: 50 / 1080 };
const DETECT_AWAY_CARD1 = { x: 1440 / 1920, y: 270 / 1080, w: 240 / 1920, h: 60 / 1080 };
const HOME_LABEL_BRIGHTNESS_MIN = 150;
const AWAY_CARD_BRIGHTNESS_MAX = 80;

/**
 * Name card layout ratios (relative to 1920x1080 reference resolution).
 * Each team has 5 cards stacked vertically. Name text is in the top half.
 */
const ROSTER_LAYOUT = {
  homeX: 200 / 1920,
  awayX: 1440 / 1920,
  startY: 270 / 1080,
  cardWidth: 240 / 1920,
  cardHeight: 60 / 1080,
  cardGap: 20 / 1080,
  playersPerTeam: 5,
};

/**
 * Check if a frame is a true roster screen (left/right card layout).
 *
 * Two-region brightness check:
 * 1. HOME label region must be bright (colored swatch + "HOME" text)
 * 2. First AWAY card region must be dark (semi-transparent card overlay)
 *
 * This distinguishes the true roster (left/right cards) from the stats
 * scoreboard (vertical layout, no AWAY cards on the right side).
 */
export async function isRosterScreen(
  framePath: string,
  config: ResolutionConfig,
): Promise<boolean> {
  const homeRegion = {
    left: Math.round(DETECT_HOME_LABEL.x * config.width),
    top: Math.round(DETECT_HOME_LABEL.y * config.height),
    width: Math.round(DETECT_HOME_LABEL.w * config.width),
    height: Math.round(DETECT_HOME_LABEL.h * config.height),
  };
  const awayRegion = {
    left: Math.round(DETECT_AWAY_CARD1.x * config.width),
    top: Math.round(DETECT_AWAY_CARD1.y * config.height),
    width: Math.round(DETECT_AWAY_CARD1.w * config.width),
    height: Math.round(DETECT_AWAY_CARD1.h * config.height),
  };

  const [homeBuf, awayBuf] = await Promise.all([
    sharp(framePath).extract(homeRegion).grayscale().raw().toBuffer({ resolveWithObject: true }),
    sharp(framePath).extract(awayRegion).grayscale().raw().toBuffer({ resolveWithObject: true }),
  ]);

  const avgBrightness = (buf: Buffer) => {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    return sum / buf.length;
  };

  const homeAvg = avgBrightness(homeBuf.data);
  const awayAvg = avgBrightness(awayBuf.data);

  return homeAvg > HOME_LABEL_BRIGHTNESS_MIN && awayAvg < AWAY_CARD_BRIGHTNESS_MAX;
}

/**
 * Parse the roster screen to extract player names for both teams.
 *
 * Strategy:
 * 1. Check if this is actually a roster screen
 * 2. Extract each of the 10 name card regions at known positions
 * 3. OCR each card individually (SINGLE_LINE mode)
 * 4. Use povPlayerName to determine which side (HOME/AWAY) is ours
 */
export async function parseRosterScreen(
  framePath: string,
  config: ResolutionConfig,
  povPlayerName: string = 'y3lvin.',
): Promise<RosterScreenData | null> {
  const isRoster = await isRosterScreen(framePath, config);
  if (!isRoster) return null;

  const { width, height } = config;
  const L = ROSTER_LAYOUT;

  // Calculate pixel positions for each name slot (top half of each card)
  const cardW = Math.round(L.cardWidth * width);
  const nameH = Math.round(L.cardHeight * height * 0.5); // Top half = name area

  const makeSlots = (xRatio: number) => {
    const slots: Array<{ left: number; top: number; width: number; height: number }> = [];
    for (let i = 0; i < L.playersPerTeam; i++) {
      const y = Math.round((L.startY + i * (L.cardHeight + L.cardGap)) * height);
      slots.push({
        left: Math.round(xRatio * width),
        top: y,
        width: cardW,
        height: nameH,
      });
    }
    return slots;
  };

  const homeSlots = makeSlots(L.homeX);
  const awaySlots = makeSlots(L.awayX);

  let worker: Tesseract.Worker | null = null;
  try {
    worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    });

    const ocrSlot = async (
      slot: { left: number; top: number; width: number; height: number },
    ): Promise<RosterEntry | null> => {
      // Threshold(180) isolates bright white name text from the semi-transparent
      // card background (game world shows through). Negate for black-on-white OCR.
      const processed = await sharp(framePath)
        .extract(slot)
        .resize(slot.width * 3, slot.height * 3, { kernel: sharp.kernel.lanczos3 })
        .grayscale()
        .threshold(180)
        .negate()
        .toBuffer();

      const { data } = await worker!.recognize(processed);
      // Take only the first word — names are single tokens (underscores, not spaces).
      // Background artifacts appear as low-confidence trailing words.
      const words = data.words ?? [];
      if (words.length === 0) return null;
      const firstWord = words[0].text.replace(/[^a-zA-Z0-9_.-]/g, '').trim();
      if (firstWord.length < 2) return null;

      const { name, number } = extractNameAndNumber(firstWord);
      if (name.length < 2) return null;

      return { name, number, confidence: data.confidence / 100 };
    };

    const homeTeam: RosterEntry[] = [];
    const awayTeam: RosterEntry[] = [];

    for (const slot of homeSlots) {
      const entry = await ocrSlot(slot);
      if (entry) homeTeam.push(entry);
    }
    for (const slot of awaySlots) {
      const entry = await ocrSlot(slot);
      if (entry) awayTeam.push(entry);
    }

    const totalNames = homeTeam.length + awayTeam.length;
    if (totalNames < MIN_ROSTER_NAMES) return null;

    // Determine which team is ours using POV player name
    if (povPlayerName) {
      const homeHasPov = homeTeam.some(e => nameMatchesPov(e.name, povPlayerName));
      const awayHasPov = awayTeam.some(e => nameMatchesPov(e.name, povPlayerName));

      if (homeHasPov && !awayHasPov) {
        console.log(`[roster] POV player "${povPlayerName}" found in HOME → HOME = our team`);
        return { ourTeam: homeTeam, oppTeam: awayTeam, frameUsed: framePath };
      } else if (awayHasPov && !homeHasPov) {
        console.log(`[roster] POV player "${povPlayerName}" found in AWAY → AWAY = our team`);
        return { ourTeam: awayTeam, oppTeam: homeTeam, frameUsed: framePath };
      } else {
        console.warn(`[roster] POV player "${povPlayerName}" not found in either team — defaulting HOME = ours`);
      }
    }

    // Default: HOME = ours
    return { ourTeam: homeTeam, oppTeam: awayTeam, frameUsed: framePath };
  } finally {
    if (worker) await worker.terminate();
  }
}

/**
 * Check if an OCR'd name matches the POV player name (fuzzy).
 * Strips non-alphanumeric chars (handles period in "y3lvin.") and does
 * case-insensitive exact + substring matching.
 */
function nameMatchesPov(ocrName: string, povName: string): boolean {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const a = clean(ocrName);
  const b = clean(povName);
  if (a.length < 3 || b.length < 3) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

/**
 * Extract player name and optional jersey number from a text line.
 *
 * Handles formats like:
 * - "grace" -> { name: "grace", number: null }
 * - "#3 opponent" -> { name: "opponent", number: 3 }
 * - "opponent 7" -> { name: "opponent", number: 7 }
 */
function extractNameAndNumber(text: string): { name: string; number: number | null } {
  // Try "#N name" pattern
  const hashMatch = text.match(/^#?(\d{1,2})\s+(.+)$/);
  if (hashMatch) {
    return { name: hashMatch[2].trim(), number: parseInt(hashMatch[1], 10) };
  }

  // Try "name #N" or "name N" at end
  const trailingMatch = text.match(/^(.+?)\s+#?(\d{1,2})$/);
  if (trailingMatch) {
    return { name: trailingMatch[1].trim(), number: parseInt(trailingMatch[2], 10) };
  }

  return { name: text, number: null };
}
