import { describe, it, expect } from 'vitest';
import { fuseDetections } from '../../src/pipeline/fuse.js';
import type { PlayerState } from '../../src/types.js';
import type { NametagDetection } from '../../src/cv/viewport.js';
import { CONFIG_1080P } from '../../src/config.js';

function makePlayer(
  id: string,
  team: 'our_team' | 'opp_team',
  x: number,
  y: number,
): PlayerState {
  return {
    playerId: id,
    displayName: null,
    team,
    position: { x, y },
    velocity: { dx: 0, dy: 0 },
    confidence: 0.8,
    positionUncertainty: 0.01,
    source: 'minimap_dot',
    currentAction: 'unknown',
    actionConfidence: 0,
    hasBall: false,
    sprintBoost: null,
    extraEffort: null,
    facingAngle: null,
    isPovPlayer: false,
    queuedAction: null,
  };
}

function makeNametag(
  text: string,
  team: 'our_team' | 'opp_team' | 'unknown',
  screenX: number,
  screenY: number,
  confidence = 0.8,
): NametagDetection {
  return { text, team, confidence, screenPosition: { x: screenX, y: screenY } };
}

describe('fuseDetections', () => {
  const config = CONFIG_1080P;

  it('identifies POV player as our_team track closest to center', () => {
    const players = [
      makePlayer('P1', 'our_team', 0.5, 0.5),   // at center
      makePlayer('P2', 'our_team', 0.3, 0.6),
      makePlayer('P3', 'opp_team', 0.7, 0.4),
    ];
    const result = fuseDetections(players, [], null, config);
    expect(result.povTrackId).toBe('P1');
  });

  it('picks closest our_team as POV even when far from center', () => {
    const players = [
      makePlayer('P1', 'our_team', 0.1, 0.1), // far from center but only our_team
      makePlayer('P2', 'opp_team', 0.5, 0.5),
    ];
    const result = fuseDetections(players, [], null, config);
    expect(result.povTrackId).toBe('P1');
  });

  it('returns null POV if no our_team tracks exist', () => {
    const players = [
      makePlayer('P2', 'opp_team', 0.5, 0.5),
    ];
    const result = fuseDetections(players, [], null, config);
    expect(result.povTrackId).toBeNull();
  });

  it('returns empty assignments when no nametags', () => {
    const players = [makePlayer('P1', 'our_team', 0.5, 0.5)];
    const result = fuseDetections(players, [], null, config);
    expect(result.nameAssignments).toHaveLength(0);
  });

  it('matches single nametag to single non-POV track', () => {
    const players = [
      makePlayer('P1', 'our_team', 0.5, 0.5),   // POV
      makePlayer('P2', 'our_team', 0.6, 0.3),   // teammate
    ];
    const nametags = [
      makeNametag('Eric_Blake', 'our_team', 800, 200),
    ];
    const result = fuseDetections(players, nametags, null, config);

    expect(result.nameAssignments).toHaveLength(1);
    expect(result.nameAssignments[0].trackId).toBe('P2');
    expect(result.nameAssignments[0].name).toBe('Eric_Blake');
  });

  it('excludes POV player from our_team matching', () => {
    // Only one our_team track = POV. Nametag should have no match.
    const players = [
      makePlayer('P1', 'our_team', 0.5, 0.5),
    ];
    const nametags = [
      makeNametag('Eric_Blake', 'our_team', 800, 200),
    ];
    const result = fuseDetections(players, nametags, null, config);
    expect(result.nameAssignments).toHaveLength(0);
  });

  it('matches opponent nametags to opponent tracks', () => {
    const players = [
      makePlayer('P1', 'our_team', 0.5, 0.5),
      makePlayer('P2', 'opp_team', 0.7, 0.3),
    ];
    const nametags = [
      makeNametag('RivalGuy', 'opp_team', 1200, 300),
    ];
    const result = fuseDetections(players, nametags, null, config);

    expect(result.nameAssignments).toHaveLength(1);
    expect(result.nameAssignments[0].trackId).toBe('P2');
    expect(result.nameAssignments[0].name).toBe('RivalGuy');
  });

  it('matches multiple nametags by screen X ordering', () => {
    const players = [
      makePlayer('P1', 'our_team', 0.5, 0.5),   // POV
      makePlayer('P2', 'our_team', 0.3, 0.3),   // left
      makePlayer('P3', 'our_team', 0.7, 0.3),   // right
    ];
    const nametags = [
      makeNametag('LeftGuy', 'our_team', 400, 200),    // left on screen
      makeNametag('RightGuy', 'our_team', 1400, 200),  // right on screen
    ];
    const result = fuseDetections(players, nametags, null, config);

    expect(result.nameAssignments).toHaveLength(2);

    const left = result.nameAssignments.find(a => a.name === 'LeftGuy');
    const right = result.nameAssignments.find(a => a.name === 'RightGuy');

    // P2 (minimap x=0.3) should match LeftGuy, P3 (x=0.7) should match RightGuy
    expect(left?.trackId).toBe('P2');
    expect(right?.trackId).toBe('P3');
  });

  it('uses camera heading for projection when available', () => {
    // Camera heading = 0 means facing RIGHT on minimap (+x direction)
    // P2 at (0.7, 0.5) is directly ahead → center of screen
    // P3 at (0.7, 0.6) is ahead + slightly to camera's right → right side of screen
    const players = [
      makePlayer('P1', 'our_team', 0.5, 0.5),   // POV
      makePlayer('P2', 'our_team', 0.7, 0.5),   // directly ahead
      makePlayer('P3', 'our_team', 0.7, 0.6),   // ahead + right
    ];
    const heading = 0; // facing right
    const nametags = [
      makeNametag('CenterGuy', 'our_team', 960, 200),   // center screen
      makeNametag('RightGuy', 'our_team', 1500, 200),    // right screen
    ];
    const result = fuseDetections(players, nametags, heading, config);

    expect(result.nameAssignments).toHaveLength(2);
    const center = result.nameAssignments.find(a => a.name === 'CenterGuy');
    const right = result.nameAssignments.find(a => a.name === 'RightGuy');
    expect(center?.trackId).toBe('P2');
    expect(right?.trackId).toBe('P3');
  });

  it('skips tracks behind camera when heading is available', () => {
    // Camera facing right (+x). P2 at x=0.2 is behind camera.
    const players = [
      makePlayer('P1', 'our_team', 0.5, 0.5),   // POV
      makePlayer('P2', 'our_team', 0.2, 0.5),   // behind (left on minimap)
      makePlayer('P3', 'our_team', 0.8, 0.5),   // ahead
    ];
    const heading = 0; // facing right
    const nametags = [
      makeNametag('AheadGuy', 'our_team', 960, 200),
    ];
    const result = fuseDetections(players, nametags, heading, config);

    expect(result.nameAssignments).toHaveLength(1);
    expect(result.nameAssignments[0].trackId).toBe('P3');
    expect(result.nameAssignments[0].name).toBe('AheadGuy');
  });

  it('handles unknown-team nametags by matching to any non-POV', () => {
    const players = [
      makePlayer('P1', 'our_team', 0.5, 0.5),   // POV
      makePlayer('P2', 'opp_team', 0.6, 0.3),
    ];
    const nametags = [
      makeNametag('Mystery', 'unknown', 1000, 200),
    ];
    const result = fuseDetections(players, nametags, null, config);

    expect(result.nameAssignments).toHaveLength(1);
    expect(result.nameAssignments[0].trackId).toBe('P2');
  });
});
