/**
 * Player identity resolution.
 * Merges nametag OCR with tracking to build player roster.
 */

import type { Team } from '../types.js';

export interface PlayerIdentity {
  trackId: string;
  displayName: string | null;
  team: Team;
  nameConfidence: number;
  nameObservations: Map<string, number>; // name -> count (for voting)
}

export interface IdentityContext {
  identities: Map<string, PlayerIdentity>;
  /** Known roster names for fuzzy matching against nametag OCR. */
  knownNames: string[];
}

/**
 * Create initial identity context.
 */
export function createIdentityContext(): IdentityContext {
  return {
    identities: new Map(),
    knownNames: [],
  };
}

/**
 * Set known roster names for fuzzy matching.
 * Call this after roster screen OCR, before gameplay processing.
 */
export function setKnownNames(
  context: IdentityContext,
  names: string[],
): void {
  context.knownNames = names.map(n => n.toLowerCase());
}

/**
 * Register a new track.
 */
export function registerTrack(
  context: IdentityContext,
  trackId: string,
  team: Team
): void {
  if (!context.identities.has(trackId)) {
    context.identities.set(trackId, {
      trackId,
      displayName: null,
      team,
      nameConfidence: 0,
      nameObservations: new Map(),
    });
  }
}

/**
 * Add a name observation from OCR.
 *
 * If known roster names are set, fuzzy-matches the observed name against them.
 * A match replaces the observation with the canonical roster name and boosts confidence.
 */
export function addNameObservation(
  context: IdentityContext,
  trackId: string,
  name: string,
  confidence: number
): void {
  const identity = context.identities.get(trackId);
  if (!identity) return;

  // Fuzzy match against known roster names
  let resolvedName = name;
  let resolvedConfidence = confidence;

  if (context.knownNames.length > 0) {
    const match = fuzzyMatchRosterName(name, context.knownNames);
    if (match) {
      resolvedName = match;
      resolvedConfidence = Math.min(confidence + 0.5, 1.0); // Roster match boost, cap at 1.0
    }
  }

  // Weight by OCR confidence
  const currentCount = identity.nameObservations.get(resolvedName) || 0;
  identity.nameObservations.set(resolvedName, currentCount + resolvedConfidence);

  // Update display name if this is now the best candidate
  updateBestName(identity);
}

/**
 * Update the display name based on observation voting.
 */
function updateBestName(identity: PlayerIdentity): void {
  let bestName: string | null = null;
  let bestScore = 0;

  for (const [name, score] of identity.nameObservations) {
    if (score > bestScore) {
      bestScore = score;
      bestName = name;
    }
  }

  identity.displayName = bestName;
  identity.nameConfidence = bestScore;
}

/**
 * Get the current player roster.
 */
export function getRoster(
  context: IdentityContext
): Map<string, { displayName: string; team: Team }> {
  const roster = new Map<string, { displayName: string; team: Team }>();

  for (const [trackId, identity] of context.identities) {
    roster.set(trackId, {
      displayName: identity.displayName || `Player_${trackId}`,
      team: identity.team,
    });
  }

  return roster;
}

// ============================================================
// Fuzzy matching
// ============================================================

/** Maximum Levenshtein distance for a fuzzy match. */
const MAX_EDIT_DISTANCE = 2;

/**
 * Fuzzy match a name against known roster names.
 * Returns the canonical roster name if a match is found, null otherwise.
 *
 * Matching strategies (in priority order):
 * 1. Exact match (case-insensitive)
 * 2. Substring: observed name is a substring of a roster name (or vice versa)
 * 3. Levenshtein distance <= MAX_EDIT_DISTANCE
 */
export function fuzzyMatchRosterName(
  observed: string,
  knownNames: string[],
): string | null {
  const lower = observed.toLowerCase().trim();
  if (lower.length < 2) return null;

  // 1. Exact match
  const exact = knownNames.find(n => n === lower);
  if (exact) return exact;

  // 2. Substring match (observed is at least 3 chars)
  if (lower.length >= 3) {
    // Prefer roster name that contains the observed text
    const containing = knownNames.find(n => n.includes(lower));
    if (containing) return containing;

    // Or observed contains a roster name
    const contained = knownNames.find(n => n.length >= 3 && lower.includes(n));
    if (contained) return contained;
  }

  // 3. Levenshtein distance
  let bestDist = MAX_EDIT_DISTANCE + 1;
  let bestMatch: string | null = null;

  for (const known of knownNames) {
    // Skip if lengths differ too much for possible match
    if (Math.abs(known.length - lower.length) > MAX_EDIT_DISTANCE) continue;

    const dist = levenshteinDistance(lower, known);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = known;
    }
  }

  return bestMatch;
}

/**
 * Compute Levenshtein edit distance between two strings.
 * Early-exits if distance exceeds MAX_EDIT_DISTANCE.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Use single-row optimization
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    let minInRow = row[0];

    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(
        row[j] + 1,        // deletion
        row[j - 1] + 1,    // insertion
        prev + cost,        // substitution
      );
      prev = row[j];
      row[j] = val;
      if (val < minInRow) minInRow = val;
    }

    // Early exit: if the minimum in this row already exceeds threshold
    if (minInRow > MAX_EDIT_DISTANCE) return minInRow;
  }

  return row[n];
}
