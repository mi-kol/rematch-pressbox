/**
 * Stage 3: Tracking & Smoothing
 *
 * - Assigns persistent IDs to players across frames
 * - Uses Hungarian algorithm for optimal assignment
 * - Applies Kalman filtering for position smoothing
 * - Pre-filters noisy markers before tracking
 * - Birth delay: requires 2+ detections before creating tracks
 * - Merges duplicate tracks for same physical player
 */

import type { PlayerState, PlayerAction, MinimapMarker, Vector2 } from '../types.js';
import { solveAssignment } from '../tracking/hungarian.js';
import { PROCESSING } from '../config.js';

/** Frames a track can go unseen before removal (5 seconds at 5fps). */
const TRACK_TIMEOUT_FRAMES = 25;

/** Max tracked players per team. Rematch is 5v5. */
const MAX_TRACKS_PER_TEAM = 5;

/** Minimum marker size (radius in pixels) to be considered for tracking. */
const MIN_MARKER_RADIUS = 2.5;

/** Minimum confidence for small markers (radius < 3.5). */
const SMALL_MARKER_MIN_CONF = 0.85;

/** Distance threshold for birth delay matching. */
const BIRTH_MATCH_DIST = 0.10;

/** Frames a pending birth can wait before being discarded. */
const BIRTH_TIMEOUT_FRAMES = 3;

/** Distance threshold for merging duplicate tracks. */
const MERGE_DIST = 0.05;

/** Distance threshold for re-identifying a graveyard track. */
const REID_DIST = 0.15;

/** Frames a graveyard entry survives before being discarded. */
const GRAVEYARD_TIMEOUT_FRAMES = 30;

/** Maximum velocity magnitude (normalized units per second). Caps runaway Kalman estimates. */
const MAX_VELOCITY = 0.5;

/** Maximum velocity variance — prevents unbounded growth during interpolation. */
const MAX_VAR_V = 0.05;

/** Frames a track can be interpolated at a boundary before early pruning. */
const BOUNDARY_GHOST_FRAMES = 3;

/** Distance from edge to be considered at the boundary. */
const BOUNDARY_THRESHOLD = 0.02;

export interface TrackingContext {
  tracks: Map<string, PlayerTrack>;
  nextId: number;
  ourTeamColor: { h: number; s: number; v: number };
  oppTeamColor: { h: number; s: number; v: number };
  /** Pending track births awaiting confirmation (birth delay). */
  pendingBirths: PendingBirth[];
  /** Recently pruned tracks for re-identification. */
  graveyard: GraveyardEntry[];
}

export interface PlayerTrack {
  id: string;
  lastPosition: Vector2;
  /** Position from last actual detection (not interpolation). Used for graveyard re-id. */
  lastObservedPosition: Vector2;
  lastVelocity: { dx: number; dy: number };
  lastSeen: number; // Frame number
  team: 'our_team' | 'opp_team';
  displayName: string | null;
  kalman: KalmanState;
}

interface PendingBirth {
  position: Vector2;
  team: 'our_team' | 'opp_team';
  confidence: number;
  frameNumber: number;
}

interface GraveyardEntry {
  id: string;
  lastPosition: Vector2;
  team: 'our_team' | 'opp_team';
  prunedFrame: number;
}

interface KalmanState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  varX: number;
  varY: number;
  varVx: number;
  varVy: number;
}

/**
 * Create initial tracking context.
 */
export function createTrackingContext(
  ourColor: { h: number; s: number; v: number },
  oppColor: { h: number; s: number; v: number }
): TrackingContext {
  return {
    tracks: new Map(),
    nextId: 1,
    ourTeamColor: ourColor,
    oppTeamColor: oppColor,
    pendingBirths: [],
    graveyard: [],
  };
}

/**
 * Update tracking with new frame detections.
 * Returns updated player states with persistent IDs.
 *
 * Pipeline: filter → split by team → Hungarian match → birth delay → merge → prune
 */
export function updateTracking(
  context: TrackingContext,
  markers: MinimapMarker[],
  frameNumber: number,
  fps: number = PROCESSING.defaultSampleFps
): PlayerState[] {
  const dt = 1 / fps;
  // Scale max assignment distance by dt (speed * time = distance), with 2x safety margin
  const maxDistance = PROCESSING.maxPlayerSpeed * dt * 2.0;

  // Pre-filter: remove tiny noise blobs
  const filtered = filterMarkers(markers);

  // Split by team (exclude arrows — they indicate off-screen direction only)
  const ourMarkers = filtered.filter(m => m.team === 'our_team' && m.shape !== 'arrow');
  const oppMarkers = filtered.filter(m => m.team === 'opp_team' && m.shape !== 'arrow');

  // Split tracks by team
  const ourTracks = new Map<string, PlayerTrack>();
  const oppTracks = new Map<string, PlayerTrack>();
  for (const [id, track] of context.tracks) {
    if (track.team === 'our_team') ourTracks.set(id, track);
    else oppTracks.set(id, track);
  }

  // Process each team independently
  const ourStates = matchTeam(context, ourTracks, ourMarkers, frameNumber, dt, maxDistance, 'our_team');
  const oppStates = matchTeam(context, oppTracks, oppMarkers, frameNumber, dt, maxDistance, 'opp_team');

  // Merge duplicate tracks (same team, very close positions)
  mergeTracks(context, frameNumber);

  // Early-prune boundary ghosts: interpolated tracks stuck near edges
  for (const [id, track] of context.tracks) {
    const framesUnseen = frameNumber - track.lastSeen;
    if (framesUnseen >= BOUNDARY_GHOST_FRAMES) {
      const { x, y } = track.lastPosition;
      const isEdge = x < BOUNDARY_THRESHOLD || x > (1 - BOUNDARY_THRESHOLD) ||
                     y < BOUNDARY_THRESHOLD || y > (1 - BOUNDARY_THRESHOLD);
      if (isEdge) {
        context.graveyard.push({
          id,
          lastPosition: { ...track.lastObservedPosition },
          team: track.team,
          prunedFrame: frameNumber,
        });
        context.tracks.delete(id);
      }
    }
  }

  // Prune lost tracks → move to graveyard for re-identification
  for (const [id, track] of context.tracks) {
    if (frameNumber - track.lastSeen > TRACK_TIMEOUT_FRAMES) {
      context.graveyard.push({
        id,
        lastPosition: { ...track.lastObservedPosition },
        team: track.team,
        prunedFrame: frameNumber,
      });
      context.tracks.delete(id);
    }
  }

  // Clean up stale pending births
  context.pendingBirths = context.pendingBirths.filter(
    pb => frameNumber - pb.frameNumber <= BIRTH_TIMEOUT_FRAMES
  );

  // Clean up stale graveyard entries
  context.graveyard = context.graveyard.filter(
    g => frameNumber - g.prunedFrame <= GRAVEYARD_TIMEOUT_FRAMES
  );

  return [...ourStates, ...oppStates];
}

// ============================================================
// Marker pre-filtering
// ============================================================

/**
 * Filter out noise markers that are too small or low-confidence.
 *
 * Real player dots: radius 3-9, area 28-250, confidence 0.80-1.0
 * Noise blobs: radius 2.2-2.5, area 15-19, confidence 0.70
 */
function filterMarkers(markers: MinimapMarker[]): MinimapMarker[] {
  return markers.filter(m => {
    // Always keep arrows (they're already filtered separately)
    if (m.shape === 'arrow') return true;

    // Hard minimum size
    if (m.radiusPixels < MIN_MARKER_RADIUS) return false;

    // Small markers need higher confidence
    if (m.radiusPixels < 3.5 && m.confidence < SMALL_MARKER_MIN_CONF) return false;

    return true;
  });
}

// ============================================================
// Per-team matching
// ============================================================

/**
 * Match markers to existing tracks for a single team.
 */
function matchTeam(
  context: TrackingContext,
  teamTracks: Map<string, PlayerTrack>,
  teamMarkers: MinimapMarker[],
  frameNumber: number,
  dt: number,
  maxDistance: number,
  team: 'our_team' | 'opp_team'
): PlayerState[] {
  // 1. Predict: advance each track's position by velocity * dt
  const predictedPositions = new Map<string, Vector2>();
  for (const [id, track] of teamTracks) {
    const predicted = kalmanPredict(track.kalman, dt);
    track.kalman = predicted;
    predictedPositions.set(id, { x: predicted.x, y: predicted.y });
  }

  // 2. Assign: Hungarian matching
  const markerPositions = teamMarkers.map(m => m.position);
  const result = solveAssignment(predictedPositions, markerPositions, maxDistance);

  const states: PlayerState[] = [];

  // 3. Update assigned tracks
  for (const { trackId, markerIndex } of result.assignments) {
    const track = context.tracks.get(trackId)!;
    const marker = teamMarkers[markerIndex];
    const measurementVariance = Math.max(0.001, (1 - marker.confidence) * 0.01);

    track.kalman = kalmanUpdate(track.kalman, marker.position, measurementVariance, dt);
    track.lastPosition = { x: track.kalman.x, y: track.kalman.y };
    track.lastObservedPosition = { ...marker.position };
    track.lastVelocity = { dx: track.kalman.vx, dy: track.kalman.vy };
    track.lastSeen = frameNumber;

    states.push(trackToPlayerState(track, marker.confidence, 'minimap_dot'));
  }

  // 4. Birth delay for unassigned markers.
  //    Only match against pendings from PREVIOUS frames (not current frame)
  //    to prevent two markers in the same frame from falsely confirming each other.
  const currentTeamCount = teamTracks.size;
  let newTracksCreated = 0;
  const newPendings: PendingBirth[] = [];

  for (const markerIndex of result.unassignedMarkers) {
    if (currentTeamCount + newTracksCreated >= MAX_TRACKS_PER_TEAM) break;

    const marker = teamMarkers[markerIndex];

    // Check if this marker matches a pending birth from a PREVIOUS frame
    const matchIdx = context.pendingBirths.findIndex(pb =>
      pb.team === team &&
      pb.frameNumber < frameNumber &&
      Math.hypot(pb.position.x - marker.position.x, pb.position.y - marker.position.y) < BIRTH_MATCH_DIST
    );

    if (matchIdx >= 0) {
      // Confirmed birth: seen in 2+ frames → create or resurrect track
      context.pendingBirths.splice(matchIdx, 1);

      // Check graveyard for re-identification (reuse old ID if close)
      const graveIdx = context.graveyard.findIndex(g =>
        g.team === team &&
        Math.hypot(g.lastPosition.x - marker.position.x, g.lastPosition.y - marker.position.y) < REID_DIST
      );

      let id: string;
      if (graveIdx >= 0) {
        id = context.graveyard[graveIdx].id;
        context.graveyard.splice(graveIdx, 1);
      } else {
        id = `P${context.nextId++}`;
      }

      const track: PlayerTrack = {
        id,
        lastPosition: { ...marker.position },
        lastObservedPosition: { ...marker.position },
        lastVelocity: { dx: 0, dy: 0 },
        lastSeen: frameNumber,
        team,
        displayName: null,
        kalman: initKalman(marker.position),
      };
      context.tracks.set(id, track);
      newTracksCreated++;

      states.push(trackToPlayerState(track, marker.confidence, 'minimap_dot'));
    } else {
      // First sighting — buffer for next frame
      newPendings.push({
        position: { ...marker.position },
        team,
        confidence: marker.confidence,
        frameNumber,
      });
    }
  }

  // Add new pendings after processing all markers
  context.pendingBirths.push(...newPendings);

  // 5. Unassigned tracks: emit as interpolated for continuity
  for (const trackId of result.unassignedTracks) {
    const track = context.tracks.get(trackId)!;
    track.lastPosition = { x: track.kalman.x, y: track.kalman.y };
    track.lastVelocity = { dx: track.kalman.vx, dy: track.kalman.vy };

    const age = frameNumber - track.lastSeen;
    const fadingConfidence = Math.max(0.1, 1 - age / TRACK_TIMEOUT_FRAMES);

    states.push(trackToPlayerState(track, fadingConfidence, 'interpolated'));
  }

  return states;
}

// ============================================================
// Track merging
// ============================================================

/**
 * Merge duplicate tracks of the same team that are very close.
 * Keeps the older (lower-ID) track; deletes the newer one.
 */
function mergeTracks(context: TrackingContext, frameNumber: number): void {
  const trackList = Array.from(context.tracks.values());

  for (let i = 0; i < trackList.length; i++) {
    for (let j = i + 1; j < trackList.length; j++) {
      const a = trackList[i];
      const b = trackList[j];
      if (a.team !== b.team) continue;

      // Skip if either track is too stale (only merge active tracks)
      if (frameNumber - a.lastSeen > 3 || frameNumber - b.lastSeen > 3) continue;

      const dist = Math.hypot(
        a.lastPosition.x - b.lastPosition.x,
        a.lastPosition.y - b.lastPosition.y,
      );

      if (dist < MERGE_DIST) {
        // Delete the newer track (higher numeric ID was created later)
        const numA = parseInt(a.id.substring(1), 10);
        const numB = parseInt(b.id.substring(1), 10);
        const toDelete = numA > numB ? a : b;
        context.tracks.delete(toDelete.id);
      }
    }
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Convert a PlayerTrack to a PlayerState for output.
 */
function trackToPlayerState(
  track: PlayerTrack,
  confidence: number,
  source: PlayerState['source']
): PlayerState {
  let { action, confidence: actionConf } = classifyAction(
    track.lastVelocity.dx,
    track.lastVelocity.dy,
  );

  // Interpolated tracks have unreliable Kalman velocity — action is unknown
  if (source === 'interpolated') {
    action = 'unknown';
    actionConf = 0.1;
  }

  return {
    playerId: track.id,
    displayName: track.displayName,
    team: track.team,
    position: { ...track.lastPosition },
    velocity: { ...track.lastVelocity },
    confidence,
    positionUncertainty: Math.sqrt(track.kalman.varX + track.kalman.varY),
    source,
    currentAction: action,
    actionConfidence: actionConf,
    hasBall: false,
    sprintBoost: null,
    extraEffort: null,
    facingAngle: null,
    isPovPlayer: false,
    queuedAction: null,
  };
}

// === Action classification ===

/** Speed thresholds (normalized units per second) for action classification. */
const IDLE_SPEED = 0.005;
const WALK_SPEED = 0.02;
const RUN_SPEED = 0.06;
const SPRINT_SPEED = 0.12;

/**
 * Classify player action from velocity magnitude.
 */
function classifyAction(vx: number, vy: number): { action: PlayerAction; confidence: number } {
  const speed = Math.hypot(vx, vy);
  if (speed < IDLE_SPEED) return { action: 'idle', confidence: 0.9 };
  if (speed < WALK_SPEED) return { action: 'walking', confidence: 0.7 };
  if (speed < RUN_SPEED) return { action: 'running', confidence: 0.7 };
  return { action: 'sprinting', confidence: 0.6 };
}

// === Kalman filter helpers ===

function initKalman(position: Vector2): KalmanState {
  return {
    x: position.x,
    y: position.y,
    vx: 0,
    vy: 0,
    varX: 0.01,
    varY: 0.01,
    varVx: 0.001,
    varVy: 0.001,
  };
}

function kalmanPredict(state: KalmanState, dt: number): KalmanState {
  return {
    x: clamp01(state.x + state.vx * dt),
    y: clamp01(state.y + state.vy * dt),
    vx: state.vx,
    vy: state.vy,
    varX: state.varX + state.varVx * dt * dt,
    varY: state.varY + state.varVy * dt * dt,
    varVx: Math.min(state.varVx * 1.1, MAX_VAR_V),
    varVy: Math.min(state.varVy * 1.1, MAX_VAR_V),
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function kalmanUpdate(
  state: KalmanState,
  measurement: Vector2,
  measurementVariance: number,
  dt: number
): KalmanState {
  const kx = state.varX / (state.varX + measurementVariance);
  const ky = state.varY / (state.varY + measurementVariance);

  const newX = clamp01(state.x + kx * (measurement.x - state.x));
  const newY = clamp01(state.y + ky * (measurement.y - state.y));

  // Standard Kalman velocity update: predicted velocity + gain-scaled innovation rate
  let newVx = state.vx + kx * (measurement.x - state.x) / dt;
  let newVy = state.vy + ky * (measurement.y - state.y) / dt;

  // Cap velocity to prevent runaway estimates from bad assignments
  const speed = Math.hypot(newVx, newVy);
  if (speed > MAX_VELOCITY) {
    const scale = MAX_VELOCITY / speed;
    newVx *= scale;
    newVy *= scale;
  }

  return {
    x: newX,
    y: newY,
    vx: newVx,
    vy: newVy,
    varX: (1 - kx) * state.varX,
    varY: (1 - ky) * state.varY,
    varVx: state.varVx * (1 - kx * 0.5),
    varVy: state.varVy * (1 - ky * 0.5),
  };
}
