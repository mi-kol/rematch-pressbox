/**
 * Minimap background subtraction.
 *
 * The field and its markings are static — only player/ball markers move.
 * By computing a median background from many frames, we can subtract it
 * to isolate only the moving markers. This eliminates field lines, border
 * artifacts, and all other static minimap elements without any geometric
 * heuristics.
 *
 * Flow:
 *   1. buildMinimapBackground() — median of N frames → clean background
 *   2. subtractBackground()     — per-pixel diff → binary foreground mask
 *   3. Pass mask to parseMinimap() as visited[] pre-filter
 */

import sharp from 'sharp';
import type { HSVColor } from '../types.js';
import type { ResolutionConfig } from '../config.js';
import { rgbToHsv } from './colors.js';

export interface MinimapBackground {
  /** Per-pixel median HSV values (length = width * height). */
  hsv: HSVColor[];
  width: number;
  height: number;
}

/**
 * Extract the minimap region from a frame as an HSV array.
 */
export async function extractMinimapHsv(
  framePath: string,
  config: ResolutionConfig
): Promise<{ hsv: HSVColor[]; width: number; height: number }> {
  const { centerX, centerY, radius } = config.minimap;

  const { data, info } = await sharp(framePath)
    .extract({
      left: centerX - radius,
      top: centerY - radius,
      width: radius * 2,
      height: radius * 2,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const hsv: HSVColor[] = [];

  for (let i = 0; i < data.length; i += channels) {
    hsv.push(rgbToHsv({ r: data[i], g: data[i + 1], b: data[i + 2] }));
  }

  return { hsv, width, height };
}

/**
 * Build a background model from multiple frames using per-pixel median.
 *
 * Median is robust to outliers — player markers appear in different positions
 * across frames, so they don't affect the median. Static elements (field lines,
 * border, pitch color) dominate and form the clean background.
 *
 * @param framePaths Array of frame image paths (recommend 15-30 frames spread across the video)
 * @param config Resolution config with minimap coordinates
 */
export async function buildMinimapBackground(
  framePaths: string[],
  config: ResolutionConfig
): Promise<MinimapBackground> {
  if (framePaths.length === 0) throw new Error('Need at least 1 frame for background');

  // Extract HSV for all frames
  const allFrames: HSVColor[][] = [];
  let width = 0, height = 0;

  for (const framePath of framePaths) {
    const result = await extractMinimapHsv(framePath, config);
    allFrames.push(result.hsv);
    width = result.width;
    height = result.height;
  }

  const pixelCount = width * height;
  const frameCount = allFrames.length;
  const background: HSVColor[] = new Array(pixelCount);

  // Compute per-pixel median
  for (let i = 0; i < pixelCount; i++) {
    const hValues: number[] = new Array(frameCount);
    const sValues: number[] = new Array(frameCount);
    const vValues: number[] = new Array(frameCount);

    for (let f = 0; f < frameCount; f++) {
      hValues[f] = allFrames[f][i].h;
      sValues[f] = allFrames[f][i].s;
      vValues[f] = allFrames[f][i].v;
    }

    background[i] = {
      h: median(hValues),
      s: median(sValues),
      v: median(vValues),
    };
  }

  return { hsv: background, width, height };
}

/**
 * Subtract background from a frame to produce a foreground mask.
 *
 * For each pixel, computes how different it is from the background.
 * Pixels that differ significantly are foreground (markers).
 * Returns a Uint8Array where 1 = background (skip), 0 = foreground (detect).
 *
 * This is inverted compared to a typical foreground mask because it feeds
 * directly into parseMinimap's `visited[]` array — background pixels are
 * pre-marked as visited so blob detection skips them.
 *
 * @param frameHsv Current frame's HSV pixels
 * @param background Background model
 * @param threshold Minimum diff to consider a pixel as foreground (default 15)
 */
export function subtractBackground(
  frameHsv: HSVColor[],
  background: MinimapBackground,
  threshold: number = 15
): Uint8Array {
  const len = Math.min(frameHsv.length, background.hsv.length);
  const mask = new Uint8Array(len);
  const { width, height } = background;

  // Circular mask: minimap is a circle inscribed in the square extraction region.
  // Only apply for actual minimap dimensions (not small test grids).
  const applyCircle = Math.min(width, height) >= 100;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const r = Math.min(width, height) / 2 - 5; // 5px inset excludes decorative border
  const r2 = r * r;

  for (let i = 0; i < len; i++) {
    if (applyCircle) {
      const px = i % width;
      const py = (i / width) | 0;
      const dx = px - cx;
      const dy = py - cy;

      // Outside the minimap circle → background (skip)
      if (dx * dx + dy * dy > r2) {
        mask[i] = 1;
        continue;
      }
    }

    const fg = frameHsv[i];
    const bg = background.hsv[i];
    const diff = hsvDiff(fg, bg);

    // 1 = background (visited/skip), 0 = foreground (detect)
    mask[i] = diff < threshold ? 1 : 0;
  }

  return mask;
}

/**
 * Compute perceptual difference between two HSV colors.
 *
 * Weights hue difference by saturation (gray pixels don't have meaningful hue).
 * Returns a value roughly in 0-100 range.
 */
function hsvDiff(a: HSVColor, b: HSVColor): number {
  // Hue difference (circular, 0-180 max)
  let dh = Math.abs(a.h - b.h);
  if (dh > 180) dh = 360 - dh;

  // Weight hue by average saturation — hue is meaningless for grays
  const avgSat = (a.s + b.s) / 2;
  const hueWeight = avgSat / 100;

  const ds = Math.abs(a.s - b.s);
  const dv = Math.abs(a.v - b.v);

  // Weighted combination: hue (scaled to 0-100) + saturation + value
  return (dh / 1.8) * hueWeight + ds * 0.3 + dv * 0.7;
}

/**
 * Compute median of a numeric array (mutates input via sort).
 */
function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 !== 0
    ? values[mid]
    : (values[mid - 1] + values[mid]) / 2;
}
