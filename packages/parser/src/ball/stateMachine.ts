/**
 * Ball state machine implementation.
 *
 * States: possessed, in_flight, loose, lost
 * Tracks ball phase transitions and possession changes.
 */

import type {
  BallState,
  BallPhase,
  BallTrajectorySource,
  Vector2,
  Vector2Velocity,
  PlayerState,
} from '../types.js';
import { PROCESSING } from '../config.js';

export interface BallContext {
  currentState: BallState;
  framesSincePhaseChange: number;
  framesWithoutCarrier: number;
}

/**
 * Create initial ball context.
 */
export function createBallContext(): BallContext {
  return {
    currentState: {
      position: { x: 0.5, y: 0.5 },
      confidence: 0,
      source: 'interpolated',
      phase: 'loose',
      previousPhase: null,
      phaseStartFrame: 0,
      movementDirection: { dx: 0, dy: 0 },
      isAirborne: false,
      trajectorySource: 'unknown',
      carrierId: null,
      previousCarrierId: null,
      targetPosition: null,
      targetConfidence: 0,
    },
    framesSincePhaseChange: 0,
    framesWithoutCarrier: 0,
  };
}

/**
 * Update ball state based on new observations.
 */
export function updateBallState(
  context: BallContext,
  ballPosition: Vector2 | null,
  ballTarget: Vector2 | null,
  players: PlayerState[],
  frameNumber: number,
  fps: number
): BallState {
  const prev = context.currentState;
  const state = { ...prev };

  // Update position if observed
  if (ballPosition) {
    state.position = ballPosition;
    state.confidence = 0.9;
    state.source = 'minimap_dot';
  } else {
    // Decay confidence when ball not observed
    state.confidence = Math.max(0, state.confidence - 0.1);
    state.source = 'interpolated';
  }

  // Update target if observed
  if (ballTarget) {
    state.targetPosition = ballTarget;
    state.targetConfidence = 0.9;
  }

  // Find carrier (player closest to ball within possession range)
  const carrier = findCarrier(state.position, players);

  // State machine transitions
  const newPhase = determinePhase(context, state, carrier, ballTarget, fps);

  if (newPhase !== state.phase) {
    state.previousPhase = state.phase;
    state.phase = newPhase;
    state.phaseStartFrame = frameNumber;
    context.framesSincePhaseChange = 0;
  } else {
    context.framesSincePhaseChange++;
  }

  // Update possession
  if (carrier) {
    if (carrier.playerId !== state.carrierId) {
      state.previousCarrierId = state.carrierId;
      state.carrierId = carrier.playerId;
    }
    context.framesWithoutCarrier = 0;
  } else {
    context.framesWithoutCarrier++;
    // Clear carrier after 3 frames without anyone in possession range
    if (context.framesWithoutCarrier >= 3 && state.carrierId) {
      state.previousCarrierId = state.carrierId;
      state.carrierId = null;
    }
  }

  // Update movement direction
  if (ballPosition && prev.position) {
    state.movementDirection = {
      dx: (ballPosition.x - prev.position.x) * fps,
      dy: (ballPosition.y - prev.position.y) * fps,
    };
  }

  context.currentState = state;
  return state;
}

/**
 * Find the player carrying the ball (if any).
 */
function findCarrier(
  ballPosition: Vector2,
  players: PlayerState[]
): PlayerState | null {
  let closest: PlayerState | null = null;
  let closestDist = Infinity;

  for (const player of players) {
    // Skip interpolated players — their positions are unreliable predictions
    if (player.source === 'interpolated') continue;
    if (player.confidence < 0.3) continue;

    const dist = Math.hypot(
      player.position.x - ballPosition.x,
      player.position.y - ballPosition.y
    );

    if (dist < closestDist && dist < PROCESSING.possessionProximity) {
      closest = player;
      closestDist = dist;
    }
  }

  return closest;
}

/**
 * Determine the current ball phase based on observations.
 */
function determinePhase(
  context: BallContext,
  state: BallState,
  carrier: PlayerState | null,
  target: Vector2 | null,
  fps: number
): BallPhase {
  const prev = state.phase;

  // If we have a carrier, ball is possessed
  if (carrier) {
    return 'possessed';
  }

  // If we have a target but no carrier, ball is in flight
  if (target && !carrier) {
    return 'in_flight';
  }

  // Transition from possessed: carrier lost
  if (prev === 'possessed' && !carrier) {
    // Brief window: could be a tackle (lost) or ball was kicked away (loose)
    // Go to 'lost' briefly to allow resolution
    if (context.framesWithoutCarrier <= 2) {
      return 'lost';
    }
    return 'loose';
  }

  // If in lost state for a short time, transition to loose
  if (prev === 'lost' && context.framesSincePhaseChange > 5) {
    return 'loose';
  }

  // If in_flight for too long without resolution, become loose
  if (prev === 'in_flight') {
    const secondsInFlight = context.framesSincePhaseChange / fps;
    if (secondsInFlight > PROCESSING.looseballTimeout) {
      return 'loose';
    }
    return 'in_flight';
  }

  // Default: stay in current phase or loose
  return prev === 'loose' ? 'loose' : prev;
}

/**
 * Detect if a one-touch action occurred.
 * Returns true if possession changed immediately to in_flight.
 */
export function detectOneTouch(
  previousState: BallState,
  currentState: BallState,
  possessionFrames: number
): boolean {
  // One-touch: in_flight -> possessed -> in_flight in very few frames
  return (
    previousState.phase === 'in_flight' &&
    currentState.phase === 'in_flight' &&
    possessionFrames <= 3 &&
    currentState.previousCarrierId !== previousState.carrierId
  );
}
