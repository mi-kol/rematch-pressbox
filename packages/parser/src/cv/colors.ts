/**
 * Color space conversion and matching utilities.
 * Works with raw pixel buffers from Sharp.
 */

import type { HSVColor, RGBColor } from '../types.js';

/**
 * Convert RGB to HSV color space.
 */
export function rgbToHsv(rgb: RGBColor): HSVColor {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const v = max * 100;

  if (delta !== 0) {
    s = (delta / max) * 100;

    if (max === r) {
      h = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      h = 60 * ((b - r) / delta + 2);
    } else {
      h = 60 * ((r - g) / delta + 4);
    }

    if (h < 0) h += 360;
  }

  return { h, s, v };
}

/**
 * Convert HSV to RGB color space.
 */
export function hsvToRgb(hsv: HSVColor): RGBColor {
  const h = hsv.h;
  const s = hsv.s / 100;
  const v = hsv.v / 100;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;

  if (h < 60) {
    r = c; g = x; b = 0;
  } else if (h < 120) {
    r = x; g = c; b = 0;
  } else if (h < 180) {
    r = 0; g = c; b = x;
  } else if (h < 240) {
    r = 0; g = x; b = c;
  } else if (h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/**
 * Calculate color distance in HSV space.
 * Returns a value between 0 (identical) and 1 (maximum difference).
 */
export function colorDistanceHsv(a: HSVColor, b: HSVColor): number {
  // Hue is circular, so we need special handling
  let hueDiff = Math.abs(a.h - b.h);
  if (hueDiff > 180) hueDiff = 360 - hueDiff;

  const hueDistance = hueDiff / 180; // Normalize to 0-1
  const satDistance = Math.abs(a.s - b.s) / 100;
  const valDistance = Math.abs(a.v - b.v) / 100;

  // Weight hue more heavily for chromatic colors
  const avgSat = (a.s + b.s) / 2;
  const hueWeight = avgSat / 100; // Less weight for desaturated colors

  return (
    hueDistance * hueWeight * 0.5 +
    satDistance * 0.3 +
    valDistance * 0.2
  );
}

/**
 * Check if two colors match within tolerance.
 */
export function colorsMatch(
  a: HSVColor,
  b: HSVColor,
  hueTolerance: number = 15,
  satTolerance: number = 30,
  valTolerance: number = 30
): boolean {
  // Hue is circular
  let hueDiff = Math.abs(a.h - b.h);
  if (hueDiff > 180) hueDiff = 360 - hueDiff;

  return (
    hueDiff <= hueTolerance &&
    Math.abs(a.s - b.s) <= satTolerance &&
    Math.abs(a.v - b.v) <= valTolerance
  );
}

/**
 * Find dominant color in a pixel buffer (RGB format).
 * Uses simple histogram-based approach.
 */
export function findDominantColor(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number = 3
): HSVColor {
  // Build histogram in HSV space with quantized bins
  const HUE_BINS = 36;    // 10-degree bins
  const SAT_BINS = 10;    // 10% bins
  const VAL_BINS = 10;    // 10% bins

  const histogram: number[][][] = Array(HUE_BINS)
    .fill(null)
    .map(() =>
      Array(SAT_BINS)
        .fill(null)
        .map(() => Array(VAL_BINS).fill(0))
    );

  const hsvAccum: { h: number; s: number; v: number; count: number }[][][] = Array(HUE_BINS)
    .fill(null)
    .map(() =>
      Array(SAT_BINS)
        .fill(null)
        .map(() =>
          Array(VAL_BINS)
            .fill(null)
            .map(() => ({ h: 0, s: 0, v: 0, count: 0 }))
        )
    );

  // First pass: count saturated vs unsaturated pixels
  let saturatedCount = 0;
  let totalCount = 0;

  for (let i = 0; i < width * height; i++) {
    const offset = i * channels;
    const hsv = rgbToHsv({
      r: pixels[offset],
      g: pixels[offset + 1],
      b: pixels[offset + 2],
    });
    if (hsv.v >= 15) {
      totalCount++;
      if (hsv.s >= 40) saturatedCount++;
    }
  }

  // If less than 20% of pixels are saturated, include gray/unsaturated pixels
  const includeGray = saturatedCount < totalCount * 0.2;

  // Second pass: build histogram
  for (let i = 0; i < width * height; i++) {
    const offset = i * channels;
    const rgb: RGBColor = {
      r: pixels[offset],
      g: pixels[offset + 1],
      b: pixels[offset + 2],
    };

    const hsv = rgbToHsv(rgb);

    // Skip very dark pixels
    if (hsv.v < 15) continue;

    // Skip unsaturated pixels unless the swatch is mostly gray
    const isSaturated = hsv.s >= 40;
    if (!isSaturated && !includeGray) continue;

    const hBin = Math.min(Math.floor(hsv.h / 10), HUE_BINS - 1);
    const sBin = Math.min(Math.floor(hsv.s / 10), SAT_BINS - 1);
    const vBin = Math.min(Math.floor(hsv.v / 10), VAL_BINS - 1);

    // Weight: saturated colors get weighted by saturation, gray gets weight 1
    const weight = isSaturated ? (hsv.s / 100) : 1.0;
    histogram[hBin][sBin][vBin] += weight;

    const accum = hsvAccum[hBin][sBin][vBin];
    accum.h += hsv.h * weight;
    accum.s += hsv.s * weight;
    accum.v += hsv.v * weight;
    accum.count += weight;
  }

  // Find the bin with most pixels
  let maxCount = 0;
  let dominantBin = { h: 0, s: 0, v: 0 };

  for (let h = 0; h < HUE_BINS; h++) {
    for (let s = 0; s < SAT_BINS; s++) {
      for (let v = 0; v < VAL_BINS; v++) {
        if (histogram[h][s][v] > maxCount) {
          maxCount = histogram[h][s][v];
          const accum = hsvAccum[h][s][v];
          dominantBin = {
            h: accum.h / accum.count,
            s: accum.s / accum.count,
            v: accum.v / accum.count,
          };
        }
      }
    }
  }

  return dominantBin;
}

/**
 * Classify which team a color belongs to.
 */
export function classifyTeamColor(
  color: HSVColor,
  ourColor: HSVColor,
  oppColor: HSVColor
): 'our_team' | 'opp_team' | 'unknown' {
  const ourDistance = colorDistanceHsv(color, ourColor);
  const oppDistance = colorDistanceHsv(color, oppColor);

  // Require that at least one distance is reasonably close
  // Otherwise it's not a team color at all
  const minDistance = Math.min(ourDistance, oppDistance);
  if (minDistance > 0.25) return 'unknown';

  // Require a minimum confidence gap between the two options
  const gap = Math.abs(ourDistance - oppDistance);
  if (gap < 0.1) return 'unknown';

  return ourDistance < oppDistance ? 'our_team' : 'opp_team';
}
