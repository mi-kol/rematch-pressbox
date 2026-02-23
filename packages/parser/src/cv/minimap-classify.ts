/**
 * Minimap pixel classification and connected-component marker extraction.
 *
 * Replaces 3-pass flood-fill blob detection with:
 *   1. Per-pixel color classification → semantic class map
 *   2. Connected components per class → clean blobs
 *   3. Blob → MinimapMarker conversion with shape/team assignment
 *
 * This approach is more principled: each pixel is independently assigned
 * to the best-matching class (our_team, opp_team, ball, white, or noise),
 * then spatial clustering produces markers. Background subtraction has
 * already removed static elements, so only marker pixels remain.
 */

import type { HSVColor, MinimapMarker } from '../types.js';

/** Pixel class values. 0 = background/noise (skip). */
export const PIXEL_CLASS = {
  BACKGROUND: 0,
  OUR_TEAM: 1,
  OPP_TEAM: 2,
  BALL: 3,
  WHITE: 4,
} as const;

/** Ball color prototype (yellow ring). */
const BALL_PROTO: HSVColor = { h: 55, s: 80, v: 80 };

/** Blob size limits for valid markers. */
const MIN_BLOB_SIZE = 15;
const MAX_BLOB_SIZE = 400;

/**
 * Classify each foreground minimap pixel by nearest color prototype.
 *
 * Pixels masked as background (mask[i]=1) stay class 0.
 * Foreground pixels are assigned to the best-matching team, ball, or white class.
 * Pixels that don't match any prototype within threshold stay class 0 (noise).
 */
export function classifyPixels(
  hsvData: HSVColor[],
  ourColor: HSVColor,
  oppColor: HSVColor,
  mask?: Uint8Array,
): Uint8Array {
  const classMap = new Uint8Array(hsvData.length);
  const ourIsGray = ourColor.s < 20;
  const oppIsGray = oppColor.s < 20;

  for (let i = 0; i < hsvData.length; i++) {
    if (mask && mask[i]) continue;

    const px = hsvData[i];

    // White/bright pixels: assign to gray team if applicable, else WHITE
    if (px.s < 20 && px.v > 60) {
      if (ourIsGray && protoDist(px, ourColor) < 15) {
        classMap[i] = PIXEL_CLASS.OUR_TEAM;
      } else if (oppIsGray && protoDist(px, oppColor) < 15) {
        classMap[i] = PIXEL_CLASS.OPP_TEAM;
      } else {
        classMap[i] = PIXEL_CLASS.WHITE;
      }
      continue;
    }

    // Yellow ball (require yellow hue range)
    if (px.h > 35 && px.h < 75 && px.s > 40 && protoDist(px, BALL_PROTO) < 25) {
      classMap[i] = PIXEL_CLASS.BALL;
      continue;
    }

    // Team classification: nearest prototype within threshold,
    // with margin requirement (winner must be clearly closer than runner-up)
    const dOur = protoDist(px, ourColor);
    const dOpp = protoDist(px, oppColor);
    const minD = Math.min(dOur, dOpp);
    const maxD = Math.max(dOur, dOpp);

    if (minD < 25 && (maxD - minD) > 5) {
      classMap[i] = dOur <= dOpp ? PIXEL_CLASS.OUR_TEAM : PIXEL_CLASS.OPP_TEAM;
    }
    // else: stays BACKGROUND (unclassified noise — ambiguous or too far from any prototype)
  }

  return classMap;
}

/**
 * Extract MinimapMarker[] from a classified pixel map via connected components.
 */
export function extractMarkers(
  classMap: Uint8Array,
  hsvData: HSVColor[],
  width: number,
  height: number,
): MinimapMarker[] {
  const visited = new Uint8Array(classMap.length);
  const markers: MinimapMarker[] = [];
  const cx = width / 2;
  const cy = height / 2;

  for (let i = 0; i < classMap.length; i++) {
    if (visited[i] || classMap[i] === PIXEL_CLASS.BACKGROUND) continue;

    const cls = classMap[i];
    const blob = floodComponent(i, cls, classMap, hsvData, visited, width, height);

    if (blob.count < MIN_BLOB_SIZE || blob.count > MAX_BLOB_SIZE) continue;

    const marker = blobToMarker(blob, cls, width, height, cx, cy);
    if (marker) markers.push(marker);
  }

  return mergeBallParts(markers, width);
}

// --- Internal types ---

interface ClassifiedBlob {
  count: number;
  minX: number; maxX: number;
  minY: number; maxY: number;
  sumX: number; sumY: number;
  sumH: number; sumS: number; sumV: number;
}

// --- BFS connected component extraction ---

function floodComponent(
  start: number,
  cls: number,
  classMap: Uint8Array,
  hsvData: HSVColor[],
  visited: Uint8Array,
  width: number,
  height: number,
): ClassifiedBlob {
  const queue = [start];
  visited[start] = 1;

  const sx = start % width;
  const sy = (start / width) | 0;
  const blob: ClassifiedBlob = {
    count: 0,
    minX: sx, maxX: sx, minY: sy, maxY: sy,
    sumX: 0, sumY: 0, sumH: 0, sumS: 0, sumV: 0,
  };

  while (queue.length > 0) {
    const idx = queue.shift()!;
    blob.count++;

    const x = idx % width;
    const y = (idx / width) | 0;
    blob.sumX += x;
    blob.sumY += y;
    if (x < blob.minX) blob.minX = x;
    if (x > blob.maxX) blob.maxX = x;
    if (y < blob.minY) blob.minY = y;
    if (y > blob.maxY) blob.maxY = y;

    const hsv = hsvData[idx];
    blob.sumH += hsv.h;
    blob.sumS += hsv.s;
    blob.sumV += hsv.v;

    // 4-connected neighbors
    if (y > 0) {
      const n = idx - width;
      if (!visited[n] && classMap[n] === cls) { visited[n] = 1; queue.push(n); }
    }
    if (y < height - 1) {
      const n = idx + width;
      if (!visited[n] && classMap[n] === cls) { visited[n] = 1; queue.push(n); }
    }
    if (x > 0) {
      const n = idx - 1;
      if (!visited[n] && classMap[n] === cls) { visited[n] = 1; queue.push(n); }
    }
    if (x < width - 1) {
      const n = idx + 1;
      if (!visited[n] && classMap[n] === cls) { visited[n] = 1; queue.push(n); }
    }
  }

  return blob;
}

// --- Blob → MinimapMarker conversion ---

function blobToMarker(
  blob: ClassifiedBlob,
  cls: number,
  width: number,
  height: number,
  cx: number,
  cy: number,
): MinimapMarker | null {
  const n = blob.count;
  const centroidX = blob.sumX / n;
  const centroidY = blob.sumY / n;
  const bw = blob.maxX - blob.minX + 1;
  const bh = blob.maxY - blob.minY + 1;
  const aspectRatio = bw / bh;
  const compactness = n / (bw * bh);
  const distFromCenter = Math.hypot(centroidX - cx, centroidY - cy);

  const avgColor: HSVColor = {
    h: blob.sumH / n,
    s: blob.sumS / n,
    v: blob.sumV / n,
  };

  const position = { x: centroidX / width, y: centroidY / height };

  // Team from class
  let team: MinimapMarker['team'] = null;
  if (cls === PIXEL_CLASS.OUR_TEAM) team = 'our_team';
  else if (cls === PIXEL_CLASS.OPP_TEAM) team = 'opp_team';

  // Shape from class + geometry
  let shape: MinimapMarker['shape'] = 'unknown';

  if (cls === PIXEL_CLASS.BALL) {
    shape = 'ball';
  } else if (cls === PIXEL_CLASS.WHITE) {
    if (distFromCenter < width * 0.15 && n < 80) {
      shape = 'pov_arrow';
    } else if (n < 60 && avgColor.v > 85) {
      shape = 'ball';
    } else {
      return null; // Unclassified white blob
    }
  } else if (team !== null) {
    // Reject very sparse/stringy blobs (noise clusters, not real markers)
    if (compactness < 0.25) return null;

    const isAtEdge = distFromCenter > width * 0.43;
    const isElongated = aspectRatio < 0.55 || aspectRatio > 1.8;

    if (isAtEdge && isElongated) {
      shape = 'arrow';
    } else if (aspectRatio > 0.4 && aspectRatio < 2.5) {
      shape = compactness < 0.60 ? 'diamond' : 'circle';
    } else {
      return null; // Extreme aspect ratio — not a player marker
    }
  } else {
    return null;
  }

  // Confidence from blob quality
  let confidence = 0.6; // Base: shape is always known at this point
  if (n > 20) confidence += 0.1;
  if (n > 50) confidence += 0.1;
  if (avgColor.s > 60) confidence += 0.1;
  if (avgColor.s > 80) confidence += 0.1;

  return {
    position,
    color: avgColor,
    shape,
    team,
    confidence: Math.min(confidence, 1.0),
    radiusPixels: Math.sqrt(n / Math.PI),
  };
}

// --- Ball marker merging (white center + yellow ring) ---

function mergeBallParts(markers: MinimapMarker[], width: number): MinimapMarker[] {
  const result: MinimapMarker[] = [];
  const used = new Set<number>();

  for (let i = 0; i < markers.length; i++) {
    if (used.has(i)) continue;
    const m = markers[i];

    if (m.shape === 'ball' && m.color.h > 35 && m.color.h < 75) {
      // Yellow ring — look for nearby white ball center
      for (let j = 0; j < markers.length; j++) {
        if (i === j || used.has(j)) continue;
        const o = markers[j];
        if (o.shape !== 'ball' || o.color.s > 25) continue;

        const dist = Math.hypot(
          (m.position.x - o.position.x) * width,
          (m.position.y - o.position.y) * width,
        );
        if (dist < 20) {
          used.add(j);
          break;
        }
      }
    }

    if (!used.has(i)) {
      result.push(m);
      used.add(i);
    }
  }

  return result;
}

// --- Color distance for prototype matching ---

/**
 * Perceptual color distance for prototype matching.
 * Weights hue by minimum saturation (grays have meaningless hue).
 */
export function protoDist(a: HSVColor, b: HSVColor): number {
  let dh = Math.abs(a.h - b.h);
  if (dh > 180) dh = 360 - dh;
  const hueWeight = Math.min(a.s, b.s) / 100;
  const ds = Math.abs(a.s - b.s);
  const dv = Math.abs(a.v - b.v);
  return (dh / 1.8) * hueWeight + ds * 0.4 + dv * 0.6;
}
