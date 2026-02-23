/**
 * Pitch geometry: relational field line masking and zone classification.
 *
 * Field markings are defined relationally - as proportions of the pitch
 * rectangle, not absolute measurements. The pitch rectangle itself is
 * auto-detected from the minimap image using projection profiles.
 *
 * Flow:
 *   1. detectPitchRect()    - find the pitch boundary in the minimap
 *   2. resolveGeometry()    - apply proportional topology to get concrete positions
 *   3. generateFieldLineMask() - rasterize into a binary pixel mask
 *   4. Pass mask to parseMinimap() to exclude field line pixels from detection
 */

import type { HSVColor, Vector2 } from '../types.js';

// ── Types ──────────────────────────────────────────────────────────────

/** A line segment in normalized 0-1 minimap coordinates. */
export interface PitchLineSegment {
  x1: number; y1: number;
  x2: number; y2: number;
}

/** A circle or arc in normalized 0-1 minimap coordinates. */
export interface PitchCircle {
  cx: number; cy: number;
  r: number;
  startAngle?: number;  // radians, default 0
  endAngle?: number;    // radians, default 2π
}

/** A point marking (penalty spot, center spot). */
export interface PitchSpot {
  x: number; y: number;
  radius: number;  // size in normalized coords
}

/** Pitch boundary rectangle in normalized minimap coordinates. */
export interface PitchRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Proportional topology: all markings defined as fractions of pitch
 * length (goal-to-goal) or width (touchline-to-touchline).
 *
 * The halfway line is always at 0.5 of pitch length (implicit).
 */
export interface PitchTopology {
  /** Center circle radius as fraction of pitch length. */
  centerCircleRadius: number;
  /** Penalty area depth from goal line, fraction of pitch length. */
  penaltyAreaDepth: number;
  /** Penalty area width (centered on goal), fraction of pitch width. */
  penaltyAreaWidth: number;
  /** Goal area depth from goal line, fraction of pitch length. */
  goalAreaDepth: number;
  /** Goal area width (centered on goal), fraction of pitch width. */
  goalAreaWidth: number;
  /** Penalty spot distance from goal line, fraction of pitch length. */
  penaltySpotDepth: number;
  /** Penalty arc radius, fraction of pitch length. */
  penaltyArcRadius: number;
}

/**
 * Resolved pitch geometry with concrete coordinates in normalized
 * minimap space (0-1). Ready for mask generation and zone classification.
 */
export interface PitchGeometry {
  pitchRect: PitchRect;
  lines: PitchLineSegment[];
  circles: PitchCircle[];
  spots: PitchSpot[];
  lineHalfWidth: number;
  /** Keep reference to the topology used for zone classification. */
  topology: PitchTopology;
}

export type PitchZone =
  | 'own_goal_area'
  | 'own_penalty_area'
  | 'own_half'
  | 'center_circle'
  | 'opp_half'
  | 'opp_penalty_area'
  | 'opp_goal_area'
  | 'off_pitch';

// ── Default Topology ───────────────────────────────────────────────────

/**
 * Standard soccer proportions as starting estimates.
 * Based on FIFA 105m x 68m pitch, but expressed as fractions.
 * These can be tuned per game without changing the structure.
 */
export const DEFAULT_TOPOLOGY: PitchTopology = {
  centerCircleRadius: 9.15 / 105,    // ~0.087
  penaltyAreaDepth:   16.5 / 105,    // ~0.157
  penaltyAreaWidth:   40.32 / 68,    // ~0.593
  goalAreaDepth:      5.5 / 105,     // ~0.052
  goalAreaWidth:      18.32 / 68,    // ~0.269
  penaltySpotDepth:   11 / 105,      // ~0.105
  penaltyArcRadius:   9.15 / 105,    // ~0.087
};

// ── Pitch Rectangle Detection ──────────────────────────────────────────

/**
 * Auto-detect the pitch rectangle from minimap HSV data using
 * projection profiles. Finds the outermost white linear structures
 * which correspond to the touchlines and goal lines.
 */
export function detectPitchRect(
  hsvData: HSVColor[],
  width: number,
  height: number,
  radius: number,
): PitchRect {
  const centerX = width / 2;
  const centerY = height / 2;

  // Column projection (sum of white pixels per column) - finds vertical lines
  const colProfile = new Float64Array(width);
  // Row projection (sum of white pixels per row) - finds horizontal lines
  const rowProfile = new Float64Array(height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Only consider pixels inside the circular minimap
      const dist = Math.hypot(x - centerX, y - centerY);
      if (dist > radius * 0.95) continue;

      const idx = y * width + x;
      const hsv = hsvData[idx];

      // White/bright field line pixel
      if (hsv.s < 20 && hsv.v > 65) {
        colProfile[x] += 1;
        rowProfile[y] += 1;
      }
    }
  }

  // Find the outermost significant peaks in each profile.
  // A "significant" column/row has white pixel count above a threshold.
  // The threshold is a fraction of the maximum profile value, to adapt
  // to varying line brightness.
  const colMax = Math.max(...colProfile);
  const rowMax = Math.max(...rowProfile);
  const colThreshold = colMax * 0.3;
  const rowThreshold = rowMax * 0.3;

  // Find leftmost and rightmost significant columns (touchlines)
  let left = 0, right = width - 1;
  for (let x = 0; x < width; x++) {
    if (colProfile[x] > colThreshold) { left = x; break; }
  }
  for (let x = width - 1; x >= 0; x--) {
    if (colProfile[x] > colThreshold) { right = x; break; }
  }

  // Find topmost and bottommost significant rows (goal lines)
  let top = 0, bottom = height - 1;
  for (let y = 0; y < height; y++) {
    if (rowProfile[y] > rowThreshold) { top = y; break; }
  }
  for (let y = height - 1; y >= 0; y--) {
    if (rowProfile[y] > rowThreshold) { bottom = y; break; }
  }

  // Normalize to 0-1
  return {
    left:   left / width,
    top:    top / height,
    right:  right / width,
    bottom: bottom / height,
  };
}

// ── Geometry Resolution ────────────────────────────────────────────────

/**
 * Resolve proportional topology into concrete geometry using the
 * detected pitch rectangle. Every marking is computed from the
 * pitch rect dimensions and the topology fractions.
 */
export function resolveGeometry(
  pitchRect: PitchRect,
  topology: PitchTopology,
  lineHalfWidth: number = 0.006,
): PitchGeometry {
  const pL = pitchRect.left;
  const pT = pitchRect.top;
  const pR = pitchRect.right;
  const pB = pitchRect.bottom;
  const pW = pR - pL;  // pitch width in normalized coords
  const pH = pB - pT;  // pitch length (height) in normalized coords
  const pCX = pL + pW / 2;  // pitch center X
  const pCY = pT + pH / 2;  // pitch center Y

  const lines: PitchLineSegment[] = [];
  const circles: PitchCircle[] = [];
  const spots: PitchSpot[] = [];

  // ── Pitch boundary ──
  // Left touchline
  lines.push({ x1: pL, y1: pT, x2: pL, y2: pB });
  // Right touchline
  lines.push({ x1: pR, y1: pT, x2: pR, y2: pB });
  // Top goal line (our goal)
  lines.push({ x1: pL, y1: pT, x2: pR, y2: pT });
  // Bottom goal line (opponent goal)
  lines.push({ x1: pL, y1: pB, x2: pR, y2: pB });

  // ── Halfway line ──
  lines.push({ x1: pL, y1: pCY, x2: pR, y2: pCY });

  // ── Center circle ──
  const ccR = topology.centerCircleRadius * pH;
  circles.push({ cx: pCX, cy: pCY, r: ccR });

  // ── Center spot ──
  spots.push({ x: pCX, y: pCY, radius: lineHalfWidth * 2 });

  // ── Penalty areas ──
  const paDepth = topology.penaltyAreaDepth * pH;
  const paHalfW = (topology.penaltyAreaWidth * pW) / 2;
  const paLeft = pCX - paHalfW;
  const paRight = pCX + paHalfW;

  // Own penalty area (top / our goal)
  lines.push({ x1: paLeft, y1: pT, x2: paLeft, y2: pT + paDepth });        // left side
  lines.push({ x1: paRight, y1: pT, x2: paRight, y2: pT + paDepth });      // right side
  lines.push({ x1: paLeft, y1: pT + paDepth, x2: paRight, y2: pT + paDepth }); // bottom edge

  // Opponent penalty area (bottom / opp goal)
  lines.push({ x1: paLeft, y1: pB, x2: paLeft, y2: pB - paDepth });        // left side
  lines.push({ x1: paRight, y1: pB, x2: paRight, y2: pB - paDepth });      // right side
  lines.push({ x1: paLeft, y1: pB - paDepth, x2: paRight, y2: pB - paDepth }); // top edge

  // ── Goal areas ──
  const gaDepth = topology.goalAreaDepth * pH;
  const gaHalfW = (topology.goalAreaWidth * pW) / 2;
  const gaLeft = pCX - gaHalfW;
  const gaRight = pCX + gaHalfW;

  // Own goal area (top)
  lines.push({ x1: gaLeft, y1: pT, x2: gaLeft, y2: pT + gaDepth });
  lines.push({ x1: gaRight, y1: pT, x2: gaRight, y2: pT + gaDepth });
  lines.push({ x1: gaLeft, y1: pT + gaDepth, x2: gaRight, y2: pT + gaDepth });

  // Opponent goal area (bottom)
  lines.push({ x1: gaLeft, y1: pB, x2: gaLeft, y2: pB - gaDepth });
  lines.push({ x1: gaRight, y1: pB, x2: gaRight, y2: pB - gaDepth });
  lines.push({ x1: gaLeft, y1: pB - gaDepth, x2: gaRight, y2: pB - gaDepth });

  // ── Penalty spots ──
  const psDepth = topology.penaltySpotDepth * pH;
  spots.push({ x: pCX, y: pT + psDepth, radius: lineHalfWidth * 2 });   // own
  spots.push({ x: pCX, y: pB - psDepth, radius: lineHalfWidth * 2 });   // opp

  // ── Penalty arcs ──
  // Arcs are portions of circles centered on the penalty spot,
  // extending outside the penalty area.
  const arcR = topology.penaltyArcRadius * pH;

  // Own penalty arc: the arc outside the own penalty area
  // Center of arc is at the penalty spot. The arc is the portion
  // of the circle that's below (greater Y than) the penalty area edge.
  const ownPaEdgeY = pT + paDepth;
  const ownArcStartAngle = Math.acos(Math.min(1, (ownPaEdgeY - (pT + psDepth)) / arcR));
  circles.push({
    cx: pCX,
    cy: pT + psDepth,
    r: arcR,
    startAngle: ownArcStartAngle,
    endAngle: Math.PI - ownArcStartAngle,
  });

  // Opponent penalty arc
  const oppPaEdgeY = pB - paDepth;
  const oppArcStartAngle = Math.acos(Math.min(1, ((pB - psDepth) - oppPaEdgeY) / arcR));
  circles.push({
    cx: pCX,
    cy: pB - psDepth,
    r: arcR,
    startAngle: Math.PI + oppArcStartAngle,
    endAngle: 2 * Math.PI - oppArcStartAngle,
  });

  return {
    pitchRect,
    lines,
    circles,
    spots,
    lineHalfWidth,
    topology,
  };
}

// ── Mask Generation ────────────────────────────────────────────────────

/**
 * Generate a binary pixel mask where 1 = field line pixel, 0 = clear.
 * Rasterizes all resolved geometry elements. Only needs to be called
 * once per session.
 */
export function generateFieldLineMask(
  geometry: PitchGeometry,
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = width / 2;  // minimap is inscribed in a circle
  const hw = geometry.lineHalfWidth;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Skip pixels outside the circular minimap
      const dist = Math.hypot(x - centerX, y - centerY);
      if (dist > radius * 0.95) continue;

      // Convert to normalized coordinates
      const nx = x / width;
      const ny = y / height;

      const idx = y * width + x;

      // Check line segments
      for (const line of geometry.lines) {
        if (pointToSegmentDistance(nx, ny, line.x1, line.y1, line.x2, line.y2) < hw) {
          mask[idx] = 1;
          break;
        }
      }
      if (mask[idx]) continue;

      // Check circles/arcs
      for (const circle of geometry.circles) {
        const d = Math.hypot(nx - circle.cx, ny - circle.cy);
        const ringDist = Math.abs(d - circle.r);
        if (ringDist < hw) {
          // Check if within arc bounds
          if (circle.startAngle != null && circle.endAngle != null) {
            const angle = Math.atan2(ny - circle.cy, nx - circle.cx);
            // Normalize angle to 0-2π
            const a = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            const start = ((circle.startAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            const end = ((circle.endAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

            if (start <= end) {
              if (a >= start && a <= end) { mask[idx] = 1; break; }
            } else {
              // Arc wraps around 0
              if (a >= start || a <= end) { mask[idx] = 1; break; }
            }
          } else {
            // Full circle
            mask[idx] = 1;
            break;
          }
        }
      }
      if (mask[idx]) continue;

      // Check spots (filled circles)
      for (const spot of geometry.spots) {
        const d = Math.hypot(nx - spot.x, ny - spot.y);
        if (d < spot.radius) {
          mask[idx] = 1;
          break;
        }
      }
    }
  }

  return mask;
}

// ── Zone Classification ────────────────────────────────────────────────

/**
 * Classify a normalized minimap position into a pitch zone.
 * Checks from most specific to least specific.
 */
export function classifyPitchZone(
  position: Vector2,
  geometry: PitchGeometry,
): PitchZone {
  const { pitchRect, topology } = geometry;
  const { left: pL, top: pT, right: pR, bottom: pB } = pitchRect;
  const pW = pR - pL;
  const pH = pB - pT;
  const pCX = pL + pW / 2;
  const pCY = pT + pH / 2;

  const { x, y } = position;

  // Off pitch?
  if (x < pL || x > pR || y < pT || y > pB) {
    return 'off_pitch';
  }

  // Compute zone boundaries
  const gaDepth = topology.goalAreaDepth * pH;
  const gaHalfW = (topology.goalAreaWidth * pW) / 2;
  const paDepth = topology.penaltyAreaDepth * pH;
  const paHalfW = (topology.penaltyAreaWidth * pW) / 2;
  const ccR = topology.centerCircleRadius * pH;

  // Own goal area (top)
  if (y < pT + gaDepth && x > pCX - gaHalfW && x < pCX + gaHalfW) {
    return 'own_goal_area';
  }

  // Opponent goal area (bottom)
  if (y > pB - gaDepth && x > pCX - gaHalfW && x < pCX + gaHalfW) {
    return 'opp_goal_area';
  }

  // Own penalty area (top)
  if (y < pT + paDepth && x > pCX - paHalfW && x < pCX + paHalfW) {
    return 'own_penalty_area';
  }

  // Opponent penalty area (bottom)
  if (y > pB - paDepth && x > pCX - paHalfW && x < pCX + paHalfW) {
    return 'opp_penalty_area';
  }

  // Center circle
  const distFromCenter = Math.hypot(x - pCX, y - pCY);
  if (distFromCenter < ccR) {
    return 'center_circle';
  }

  // Own half vs opponent half
  if (y < pCY) {
    return 'own_half';
  }

  return 'opp_half';
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Perpendicular distance from point (px, py) to line segment
 * (x1, y1)-(x2, y2).
 */
export function pointToSegmentDistance(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (point)
    return Math.hypot(px - x1, py - y1);
  }

  // Project point onto the line, clamped to segment
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;

  return Math.hypot(px - closestX, py - closestY);
}
