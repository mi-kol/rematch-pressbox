/**
 * Minimap detection and parsing.
 *
 * - Isolates the circular minimap region
 * - Classifies pixels by color prototype (our_team, opp_team, ball, white)
 * - Extracts connected components → MinimapMarker[]
 * - Detects ball and ball target markers
 * - Extracts POV player facing direction
 */

import sharp from 'sharp';
import type { MinimapDetection, MinimapMarker, HSVColor, Vector2 } from '../types.js';
import type { ResolutionConfig } from '../config.js';
import { rgbToHsv } from './colors.js';
import { classifyPixels, extractMarkers } from './minimap-classify.js';

export interface MinimapParseOptions {
  config: ResolutionConfig;
  ourColor: HSVColor;
  oppColor: HSVColor;
  /** Optional field line mask (from pitch.ts). Pixels marked 1 are skipped during detection. */
  fieldLineMask?: Uint8Array;
  /**
   * Background subtraction mask (from minimap-bg.ts).
   * 1 = background (skip), 0 = foreground (detect).
   * When provided, takes precedence over fieldLineMask.
   */
  backgroundMask?: Uint8Array;
}

/**
 * Extract and parse the minimap from a frame.
 */
export async function parseMinimap(
  framePath: string,
  options: MinimapParseOptions
): Promise<MinimapDetection> {
  const { config, ourColor, oppColor, fieldLineMask, backgroundMask } = options;
  const { centerX, centerY, radius } = config.minimap;

  // Extract minimap region
  const { data: pixels, info } = await sharp(framePath)
    .extract({
      left: centerX - radius,
      top: centerY - radius,
      width: radius * 2,
      height: radius * 2,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;

  // Convert to HSV
  const hsvData: HSVColor[] = [];
  for (let i = 0; i < width * height; i++) {
    const offset = i * channels;
    hsvData.push(rgbToHsv({
      r: pixels[offset],
      g: pixels[offset + 1],
      b: pixels[offset + 2],
    }));
  }

  // Build mask: background subtraction preferred, field line mask as fallback
  let mask = backgroundMask;
  if (!mask && fieldLineMask) {
    // Apply field line mask with color gate (only mask white-ish pixels at line positions)
    mask = new Uint8Array(fieldLineMask.length);
    for (let i = 0; i < fieldLineMask.length && i < hsvData.length; i++) {
      if (fieldLineMask[i] && hsvData[i].s < 30 && hsvData[i].v > 50) {
        mask[i] = 1;
      }
    }
  }

  // Classify pixels by color prototype and extract markers via connected components
  const classMap = classifyPixels(hsvData, ourColor, oppColor, mask);
  const allMarkers = extractMarkers(classMap, hsvData, width, height);

  // Separate markers by type
  const ballMarker = allMarkers.find(m => m.shape === 'ball') || null;
  const ballTargetMarker = allMarkers.find(m => m.shape === 'ball_target') || null;
  const povArrow = allMarkers.find(m => m.shape === 'pov_arrow');
  const playerMarkers = allMarkers.filter(m =>
    m.shape !== 'ball' && m.shape !== 'ball_target' && m.shape !== 'pov_arrow'
  );

  // Calculate POV arrow angle from its position relative to center
  const povArrowAngle = povArrow ? calculateArrowAngle(povArrow) : null;

  return {
    markers: playerMarkers,
    ballMarker,
    ballTargetMarker,
    povArrowAngle,
    minimapCenter: { x: centerX, y: centerY },
    minimapRadius: radius,
  };
}

/**
 * Calculate the angle a POV arrow is pointing.
 */
function calculateArrowAngle(marker: MinimapMarker): number {
  const dx = marker.position.x - 0.5;
  const dy = marker.position.y - 0.5;

  if (Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02) {
    return Math.atan2(dy, dx);
  }

  return 0;
}

/**
 * Convert minimap pixel position to normalized coordinates.
 */
export function minimapToNormalized(
  pixelPos: { x: number; y: number },
  minimapRadius: number
): Vector2 {
  const normalizedX = (pixelPos.x - minimapRadius) / minimapRadius;
  const normalizedY = (pixelPos.y - minimapRadius) / minimapRadius;

  return {
    x: (normalizedX + 1) / 2,
    y: (normalizedY + 1) / 2,
  };
}

/**
 * Debug function to save minimap detection visualization.
 */
export async function debugSaveMinimapDetection(
  framePath: string,
  options: MinimapParseOptions,
  _outputPath: string
): Promise<MinimapDetection> {
  const detection = await parseMinimap(framePath, options);

  console.log('[minimap] Detection results:');
  console.log(`  Player markers: ${detection.markers.length}`);
  console.log(`  Ball: ${detection.ballMarker ? 'found' : 'not found'}`);
  console.log(`  POV angle: ${detection.povArrowAngle?.toFixed(2) ?? 'unknown'}`);

  for (const marker of detection.markers) {
    console.log(`  - ${marker.shape} at (${marker.position.x.toFixed(2)}, ${marker.position.y.toFixed(2)}) team=${marker.team ?? 'unknown'}`);
  }

  return detection;
}
