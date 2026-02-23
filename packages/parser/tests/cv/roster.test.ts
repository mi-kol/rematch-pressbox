import { describe, it, expect } from 'vitest';
import {
  createIdentityContext,
  registerTrack,
  addNameObservation,
  setKnownNames,
  getRoster,
  fuzzyMatchRosterName,
} from '../../src/tracking/identity.js';

describe('fuzzyMatchRosterName', () => {
  const knownNames = ['grace', 'striker', 'shadow', 'phoenix', 'blaze'];

  it('matches exact name (case-insensitive)', () => {
    expect(fuzzyMatchRosterName('grace', knownNames)).toBe('grace');
    expect(fuzzyMatchRosterName('Grace', knownNames)).toBe('grace');
    expect(fuzzyMatchRosterName('GRACE', knownNames)).toBe('grace');
  });

  it('matches substring (observed is prefix/subset)', () => {
    expect(fuzzyMatchRosterName('grac', knownNames)).toBe('grace');
    expect(fuzzyMatchRosterName('strik', knownNames)).toBe('striker');
    expect(fuzzyMatchRosterName('shad', knownNames)).toBe('shadow');
  });

  it('matches by Levenshtein distance <= 2', () => {
    expect(fuzzyMatchRosterName('grce', knownNames)).toBe('grace');   // 1 deletion
    expect(fuzzyMatchRosterName('gracee', knownNames)).toBe('grace'); // 1 insertion
    expect(fuzzyMatchRosterName('graca', knownNames)).toBe('grace');  // 1 substitution
  });

  it('returns null for no match', () => {
    expect(fuzzyMatchRosterName('zzzzz', knownNames)).toBeNull();
    expect(fuzzyMatchRosterName('a', knownNames)).toBeNull(); // too short
    expect(fuzzyMatchRosterName('completely_different_name', knownNames)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(fuzzyMatchRosterName('', knownNames)).toBeNull();
    expect(fuzzyMatchRosterName('x', knownNames)).toBeNull();
  });
});

describe('identity system with known roster names', () => {
  it('fuzzy-matches nametag OCR against roster names', () => {
    const ctx = createIdentityContext();
    setKnownNames(ctx, ['grace', 'striker', 'shadow']);

    registerTrack(ctx, 'P1', 'our_team');

    // Noisy OCR reads "grac" — should resolve to "grace" with boosted confidence
    addNameObservation(ctx, 'P1', 'grac', 0.3);

    const roster = getRoster(ctx);
    expect(roster.get('P1')?.displayName).toBe('grace');
  });

  it('boosted roster matches outweigh multiple noisy observations', () => {
    const ctx = createIdentityContext();
    setKnownNames(ctx, ['grace', 'striker']);

    registerTrack(ctx, 'P1', 'our_team');

    // Multiple noisy observations of wrong name
    addNameObservation(ctx, 'P1', 'noise1', 0.3);
    addNameObservation(ctx, 'P1', 'noise1', 0.3);

    // One roster-matched observation should win (boosted to 1.0)
    addNameObservation(ctx, 'P1', 'grac', 0.3);

    const roster = getRoster(ctx);
    expect(roster.get('P1')?.displayName).toBe('grace');
  });

  it('works without known names (backwards compatible)', () => {
    const ctx = createIdentityContext();

    registerTrack(ctx, 'P1', 'our_team');
    addNameObservation(ctx, 'P1', 'grace', 0.9);

    const roster = getRoster(ctx);
    expect(roster.get('P1')?.displayName).toBe('grace');
  });

  it('assigns different roster names to different tracks', () => {
    const ctx = createIdentityContext();
    setKnownNames(ctx, ['grace', 'striker', 'shadow']);

    registerTrack(ctx, 'P1', 'our_team');
    registerTrack(ctx, 'P2', 'our_team');

    addNameObservation(ctx, 'P1', 'grac', 0.4);
    addNameObservation(ctx, 'P2', 'strik', 0.4);

    const roster = getRoster(ctx);
    expect(roster.get('P1')?.displayName).toBe('grace');
    expect(roster.get('P2')?.displayName).toBe('striker');
  });
});
