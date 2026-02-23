/**
 * Viewport–minimap fusion.
 *
 * Cross-references viewport nametag detections (screen-space names + team)
 * with minimap-tracked player positions to bind player names to persistent
 * track IDs via the identity voting system.
 *
 * Approach:
 *   1. Identify POV player (our_team track closest to minimap center)
 *   2. Project minimap positions to approximate screen X using camera heading
 *   3. Greedy-match nametags to tracks by projected screen proximity
 *   4. Return (trackId, name, confidence) tuples for identity voting
 *
 * The identity voting system (tracking/identity.ts) smooths errors over time,
 * so per-frame matching doesn't need to be perfect.
 */

import type { PlayerState } from '../types.js';
import type { NametagDetection } from '../cv/viewport.js';
import type { ResolutionConfig } from '../config.js';

export interface FusionResult {
  /** Name → trackId assignments with confidence. */
  nameAssignments: NameAssignment[];
  /** TrackId of the POV player (our_team track closest to minimap center). */
  povTrackId: string | null;
}

export interface NameAssignment {
  trackId: string;
  name: string;
  confidence: number;
}

/**
 * Fuse viewport nametag detections with tracked minimap players.
 */
export function fuseDetections(
  players: PlayerState[],
  nametags: NametagDetection[],
  cameraHeading: number | null,
  config: ResolutionConfig,
): FusionResult {
  const povTrackId = findPovTrack(players);

  if (nametags.length === 0) {
    return { nameAssignments: [], povTrackId };
  }

  const assignments: NameAssignment[] = [];

  // Process each team separately
  for (const team of ['our_team', 'opp_team'] as const) {
    const teamNametags = nametags.filter(nt => nt.team === team);
    if (teamNametags.length === 0) continue;

    // Exclude POV from our_team matching — you don't see your own nametag
    const teamTracks = players.filter(p =>
      p.team === team && p.playerId !== povTrackId
    );
    if (teamTracks.length === 0) continue;

    assignments.push(
      ...matchTeamNametags(teamNametags, teamTracks, cameraHeading, config),
    );
  }

  // Unknown-team nametags — try matching to any non-POV player
  const unknownNametags = nametags.filter(nt => nt.team === 'unknown');
  if (unknownNametags.length > 0) {
    const allNonPov = players.filter(p => p.playerId !== povTrackId);
    assignments.push(
      ...matchTeamNametags(unknownNametags, allNonPov, cameraHeading, config),
    );
  }

  return { nameAssignments: assignments, povTrackId };
}

// ============================================================
// POV player identification
// ============================================================

/** Minimap center in normalized coords. */
const MINIMAP_CENTER = 0.5;

/**
 * Find the POV player: the our_team track closest to minimap center (0.5, 0.5).
 *
 * In Rematch, the minimap is player-centered, so the POV player's dot
 * is always near the center. With imperfect tracking, the closest track
 * may still be far from center due to tracking drift — we still pick
 * it as the best POV candidate since it gets us closer than random.
 * The identity system smooths errors over time.
 */
function findPovTrack(players: PlayerState[]): string | null {
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const p of players) {
    if (p.team !== 'our_team') continue;
    const d = Math.hypot(
      p.position.x - MINIMAP_CENTER,
      p.position.y - MINIMAP_CENTER,
    );
    if (d < bestDist) {
      bestDist = d;
      bestId = p.playerId;
    }
  }

  return bestId;
}

// ============================================================
// Nametag-to-track matching
// ============================================================

/**
 * Match a set of nametags to tracks of the same team.
 *
 * Strategy:
 * - If cameraHeading available: project tracks to approximate screen X,
 *   then greedy-match by screen proximity.
 * - If no heading: fall back to minimap-X ordering.
 */
function matchTeamNametags(
  nametags: NametagDetection[],
  tracks: PlayerState[],
  cameraHeading: number | null,
  config: ResolutionConfig,
): NameAssignment[] {
  if (nametags.length === 0 || tracks.length === 0) return [];

  if (cameraHeading !== null) {
    return matchWithProjection(nametags, tracks, cameraHeading, config);
  }
  return matchByOrder(nametags, tracks, config);
}

/**
 * Project minimap positions to approximate screen X using camera heading,
 * then greedy-match nametags by proximity.
 *
 * Projection model (fixed-orientation minimap):
 *   offset = (track.pos - 0.5)  relative to POV
 *   forward = offset · heading   component along camera direction
 *   right = offset · heading⊥    component perpendicular (positive = right)
 *   screenX ≈ width/2 + (right / forward) * focalScale
 */
function matchWithProjection(
  nametags: NametagDetection[],
  tracks: PlayerState[],
  heading: number,
  config: ResolutionConfig,
): NameAssignment[] {
  const cosH = Math.cos(heading);
  const sinH = Math.sin(heading);

  // Project each track to approximate screen X
  const projected: Array<{ track: PlayerState; screenX: number }> = [];

  for (const track of tracks) {
    const dx = track.position.x - MINIMAP_CENTER;
    const dy = track.position.y - MINIMAP_CENTER;

    // Camera-relative coordinates
    const forward = dx * cosH + dy * sinH;
    const right = -dx * sinH + dy * cosH;

    // Skip tracks behind camera (not visible on screen)
    if (forward < -0.02) continue;

    // Perspective projection: screenX ∝ right / forward
    const fwd = Math.max(forward, 0.04); // clamp near-zero
    const focalScale = config.width * 0.6;
    const screenX = config.width / 2 + (right / fwd) * focalScale;

    projected.push({ track, screenX });
  }

  if (projected.length === 0) {
    // All tracks behind camera — fall back to ordering
    return matchByOrder(nametags, tracks, config);
  }

  return greedyMatchByScreenX(nametags, projected, config);
}

/**
 * Fallback matching without camera heading:
 * sort tracks by minimap X, nametags by screen X, match greedily.
 */
function matchByOrder(
  nametags: NametagDetection[],
  tracks: PlayerState[],
  config: ResolutionConfig,
): NameAssignment[] {
  // Estimate screen X from minimap X (simple linear mapping)
  const projected = tracks.map(track => ({
    track,
    screenX: track.position.x * config.width,
  }));

  return greedyMatchByScreenX(nametags, projected, config);
}

/**
 * Greedy nametag-to-track matching by screen X distance.
 *
 * Builds all (nametag, track) pairs, sorts by distance, then greedily
 * assigns 1-to-1 keeping the closest pairs.
 */
function greedyMatchByScreenX(
  nametags: NametagDetection[],
  projected: Array<{ track: PlayerState; screenX: number }>,
  config: ResolutionConfig,
): NameAssignment[] {
  // Reject threshold: nametag and projected track more than 40% of screen apart
  const maxDist = config.width * 0.4;

  // Build all pairs sorted by distance
  const pairs: Array<{ ntIdx: number; trkIdx: number; dist: number }> = [];
  for (let ni = 0; ni < nametags.length; ni++) {
    for (let ti = 0; ti < projected.length; ti++) {
      const dist = Math.abs(nametags[ni].screenPosition.x - projected[ti].screenX);
      pairs.push({ ntIdx: ni, trkIdx: ti, dist });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist);

  // Greedy 1-to-1 assignment
  const usedNT = new Set<number>();
  const usedTrk = new Set<number>();
  const assignments: NameAssignment[] = [];

  for (const { ntIdx, trkIdx, dist } of pairs) {
    if (usedNT.has(ntIdx) || usedTrk.has(trkIdx)) continue;
    if (dist > maxDist) continue;

    usedNT.add(ntIdx);
    usedTrk.add(trkIdx);

    // Discount confidence by screen distance (closer = more certain)
    const distFactor = Math.max(0.3, 1 - dist / config.width);

    assignments.push({
      trackId: projected[trkIdx].track.playerId,
      name: nametags[ntIdx].text,
      confidence: nametags[ntIdx].confidence * distFactor,
    });
  }

  return assignments;
}
