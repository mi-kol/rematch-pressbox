import { describe, it, expect } from 'vitest';
import { createTrackingContext, updateTracking } from '../../src/pipeline/track.js';
import type { MinimapMarker } from '../../src/types.js';

function makeMarker(
  x: number,
  y: number,
  team: 'our_team' | 'opp_team',
  shape: MinimapMarker['shape'] = 'circle'
): MinimapMarker {
  return {
    position: { x, y },
    color: { h: 0, s: 0, v: 80 },
    shape,
    team,
    confidence: 0.9,
    radiusPixels: 5,
  };
}

/** Helper: send markers for 2 frames to pass birth delay. */
function birthTracks(
  ctx: ReturnType<typeof createTrackingContext>,
  markers: MinimapMarker[],
) {
  updateTracking(ctx, markers, 0); // frame 0: pending
  return updateTracking(ctx, markers, 1); // frame 1: confirmed → tracks born
}

describe('updateTracking', () => {
  it('creates tracks after birth delay (2 frames)', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });
    const markers = [
      makeMarker(0.3, 0.4, 'our_team'),
      makeMarker(0.7, 0.6, 'opp_team'),
    ];

    // Frame 0: no tracks yet (pending birth)
    const states0 = updateTracking(ctx, markers, 0);
    expect(states0).toHaveLength(0);

    // Frame 1: markers confirmed → tracks born
    const states1 = updateTracking(ctx, markers, 1);
    expect(states1).toHaveLength(2);
    expect(ctx.tracks.size).toBe(2);

    const ourPlayer = states1.find(s => s.team === 'our_team')!;
    const oppPlayer = states1.find(s => s.team === 'opp_team')!;
    expect(ourPlayer.position.x).toBeCloseTo(0.3, 2);
    expect(oppPlayer.position.x).toBeCloseTo(0.7, 2);
  });

  it('assigns persistent IDs across frames', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });

    const markers = [
      makeMarker(0.3, 0.4, 'our_team'),
      makeMarker(0.5, 0.5, 'our_team'),
    ];
    const born = birthTracks(ctx, markers);
    const id1 = born.find(s => s.position.x < 0.4)!.playerId;
    const id2 = born.find(s => s.position.x > 0.4)!.playerId;

    // Frame 2: markers moved slightly
    const markers2 = [
      makeMarker(0.31, 0.41, 'our_team'),
      makeMarker(0.51, 0.49, 'our_team'),
    ];
    const states2 = updateTracking(ctx, markers2, 2);

    // Same IDs should persist
    const player1 = states2.find(s => s.position.x < 0.4)!;
    const player2 = states2.find(s => s.position.x > 0.4)!;
    expect(player1.playerId).toBe(id1);
    expect(player2.playerId).toBe(id2);
  });

  it('creates new track when a new player appears (after birth delay)', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });

    // Frames 0-1: birth first player
    birthTracks(ctx, [makeMarker(0.3, 0.4, 'our_team')]);
    expect(ctx.tracks.size).toBe(1);

    // Frame 2: second player appears (pending)
    const markers2 = [
      makeMarker(0.31, 0.41, 'our_team'),
      makeMarker(0.8, 0.2, 'our_team'),
    ];
    updateTracking(ctx, markers2, 2);
    expect(ctx.tracks.size).toBe(1); // still pending

    // Frame 3: second player confirmed
    const markers3 = [
      makeMarker(0.32, 0.42, 'our_team'),
      makeMarker(0.81, 0.21, 'our_team'),
    ];
    updateTracking(ctx, markers3, 3);
    expect(ctx.tracks.size).toBe(2); // now confirmed
  });

  it('removes tracks after timeout', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });

    // Birth a track (frames 0-1)
    birthTracks(ctx, [makeMarker(0.3, 0.4, 'our_team')]);
    expect(ctx.tracks.size).toBe(1);

    // Frames 2-27: player disappears (timeout is 25 frames)
    for (let f = 2; f <= 27; f++) {
      updateTracking(ctx, [], f);
    }

    // Track should be pruned after 25 frames of absence
    expect(ctx.tracks.size).toBe(0);
  });

  it('emits interpolated states for temporarily lost tracks', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });

    // Birth a track
    const born = birthTracks(ctx, [makeMarker(0.3, 0.4, 'our_team')]);
    const playerId = born[0].playerId;

    // Frame 2: player not detected but track still alive
    const states2 = updateTracking(ctx, [], 2);
    expect(states2).toHaveLength(1);
    expect(states2[0].playerId).toBe(playerId);
    expect(states2[0].source).toBe('interpolated');
    expect(states2[0].confidence).toBeLessThan(1);
  });

  it('separates teams during matching', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });

    // Birth both teams at same position
    const markers = [
      makeMarker(0.5, 0.5, 'our_team'),
      makeMarker(0.5, 0.5, 'opp_team'),
    ];
    const born = birthTracks(ctx, markers);
    expect(born).toHaveLength(2);

    const ourId = born.find(s => s.team === 'our_team')!.playerId;
    const oppId = born.find(s => s.team === 'opp_team')!.playerId;
    expect(ourId).not.toBe(oppId);

    // Frame 2: both move slightly
    const markers2 = [
      makeMarker(0.51, 0.49, 'our_team'),
      makeMarker(0.49, 0.51, 'opp_team'),
    ];
    const states2 = updateTracking(ctx, markers2, 2);

    // IDs should be preserved per team
    expect(states2.find(s => s.team === 'our_team')!.playerId).toBe(ourId);
    expect(states2.find(s => s.team === 'opp_team')!.playerId).toBe(oppId);
  });

  it('filters out arrow markers from tracking', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });

    const markers = [
      makeMarker(0.3, 0.4, 'our_team', 'circle'),
      makeMarker(0.9, 0.5, 'our_team', 'arrow'),
    ];

    // Birth: only circle should create a pending then track
    const born = birthTracks(ctx, markers);
    expect(born).toHaveLength(1);
    expect(ctx.tracks.size).toBe(1);
  });

  it('Kalman smoothing produces position near measurement', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });

    // Birth at (0.5, 0.5)
    birthTracks(ctx, [makeMarker(0.5, 0.5, 'our_team')]);

    // Frame 2: move to (0.52, 0.48)
    const states2 = updateTracking(ctx, [makeMarker(0.52, 0.48, 'our_team')], 2);
    const pos = states2[0].position;

    expect(pos.x).toBeCloseTo(0.52, 1);
    expect(pos.y).toBeCloseTo(0.48, 1);
  });

  it('velocity is updated after movement', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });

    // Birth at (0.5, 0.5)
    birthTracks(ctx, [makeMarker(0.5, 0.5, 'our_team')]);

    // Frame 2: moved right
    const states = updateTracking(ctx, [makeMarker(0.55, 0.5, 'our_team')], 2);

    // Velocity should reflect rightward movement
    expect(states[0].velocity.dx).toBeGreaterThan(0);
  });

  it('positionUncertainty decreases with observations', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });

    // Birth track
    const born = birthTracks(ctx, [makeMarker(0.5, 0.5, 'our_team')]);
    const unc0 = born[0].positionUncertainty;

    // Frame 2: observe again
    const states2 = updateTracking(ctx, [makeMarker(0.51, 0.49, 'our_team')], 2);
    const unc1 = states2[0].positionUncertainty;

    // Uncertainty should decrease with more observations
    expect(unc1).toBeLessThan(unc0);
  });

  it('filters out tiny noise blobs', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });

    const markers = [
      makeMarker(0.3, 0.4, 'our_team'),  // radiusPixels=5: passes filter
      { ...makeMarker(0.7, 0.6, 'our_team'), radiusPixels: 2.2, confidence: 0.7 },  // tiny + low conf: filtered
    ];

    // Only the good marker should go through birth delay
    updateTracking(ctx, markers, 0);
    const born = updateTracking(ctx, markers, 1);
    expect(born).toHaveLength(1);
    expect(born[0].position.x).toBeCloseTo(0.3, 2);
  });

  it('merges duplicate tracks that converge', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });

    // Birth two tracks close enough to converge but far enough to be separate
    const markers01 = [
      makeMarker(0.47, 0.50, 'our_team'),
      makeMarker(0.53, 0.50, 'our_team'),
    ];
    birthTracks(ctx, markers01);
    expect(ctx.tracks.size).toBe(2);

    // Frame 2: move them to nearly the same position (within maxPlayerSpeed=0.15)
    const markers2 = [
      makeMarker(0.49, 0.50, 'our_team'),
      makeMarker(0.51, 0.50, 'our_team'),
    ];
    updateTracking(ctx, markers2, 2);

    // After Kalman update, tracks should be within MERGE_DIST=0.05 and merge
    expect(ctx.tracks.size).toBe(1);
  });

  it('classifies player actions from velocity', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });

    // Birth at (0.5, 0.5)
    birthTracks(ctx, [makeMarker(0.5, 0.5, 'our_team')]);

    // Frame 2: stationary → idle
    const idle = updateTracking(ctx, [makeMarker(0.5, 0.5, 'our_team')], 2);
    expect(idle[0].currentAction).toBe('idle');

    // Frame 3: move significantly → running or sprinting
    const moving = updateTracking(ctx, [makeMarker(0.55, 0.5, 'our_team')], 3);
    expect(['running', 'sprinting']).toContain(moving[0].currentAction);
  });

  it('re-identifies tracks that reappear after pruning', () => {
    const ctx = createTrackingContext({ h: 0, s: 3, v: 78 }, { h: 94, s: 97, v: 57 });

    // Birth a track at (0.3, 0.4) (frames 0-1)
    const born = birthTracks(ctx, [makeMarker(0.3, 0.4, 'our_team')]);
    const originalId = born[0].playerId;
    expect(ctx.tracks.size).toBe(1);

    // Disappear for 26 frames → track pruned (timeout=25)
    for (let f = 2; f <= 27; f++) {
      updateTracking(ctx, [], f);
    }
    expect(ctx.tracks.size).toBe(0);
    expect(ctx.graveyard.length).toBe(1);

    // Reappear near same position (within REID_DIST=0.15) — birth delay
    const reappear = [makeMarker(0.32, 0.42, 'our_team')];
    updateTracking(ctx, reappear, 28); // pending
    const reborn = updateTracking(ctx, reappear, 29); // confirmed

    // Should reuse the original ID
    expect(reborn).toHaveLength(1);
    expect(reborn[0].playerId).toBe(originalId);
    expect(ctx.graveyard.length).toBe(0);
  });
});
