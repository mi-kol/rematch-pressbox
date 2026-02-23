/**
 * Stage 4: Enrichment
 *
 * - Detects goals from score changes
 * - Identifies scorers from ball carrier before goal
 * - Identifies assisters from previous carrier
 * - Detects priority interactions (multiple players near ball)
 */

import type { FrameState, MatchData, PriorityInteraction } from '../types.js';

/**
 * Detect goals from score changes between frames.
 * Identifies scorer as ball carrier in frames before the goal.
 */
/** Frames to skip after detecting a goal (prevents duplicate detections from OCR bounce). */
const GOAL_COOLDOWN_FRAMES = 15;

export function detectGoals(frames: FrameState[]): MatchData['goals'] {
  const goals: MatchData['goals'] = [];
  let cooldown = 0;

  for (let i = 1; i < frames.length; i++) {
    if (cooldown > 0) {
      cooldown--;
      continue;
    }

    const prev = frames[i - 1];
    const curr = frames[i];

    const ourDelta = curr.gameState.scoreOurs - prev.gameState.scoreOurs;
    const oppDelta = curr.gameState.scoreOpponent - prev.gameState.scoreOpponent;

    // Score can only increase by exactly 1 for one team at a time
    const ourScored = ourDelta === 1 && oppDelta === 0;
    const oppScored = oppDelta === 1 && ourDelta === 0;

    if (!ourScored && !oppScored) continue;

    const team = ourScored ? 'our_team' : 'opp_team';

    // Look back up to 15 frames (~3s) for ball carrier as scorer
    const { scorerId, assisterId } = findScorerAndAssister(frames, i, team);

    goals.push({
      frameNumber: curr.frameNumber,
      scorerId,
      assisterId,
      team,
      scoreAfter: {
        ours: curr.gameState.scoreOurs,
        opponent: curr.gameState.scoreOpponent,
      },
    });

    cooldown = GOAL_COOLDOWN_FRAMES;
  }

  return goals;
}

/**
 * Look back through recent frames to find the scorer and assister.
 *
 * Scorer: last player of the scoring team who possessed the ball.
 * Assister: the player who possessed the ball before the scorer.
 */
function findScorerAndAssister(
  frames: FrameState[],
  goalFrameIdx: number,
  team: 'our_team' | 'opp_team',
): { scorerId: string | null; assisterId: string | null } {
  const lookback = Math.min(15, goalFrameIdx);
  let scorerId: string | null = null;
  let assisterId: string | null = null;

  for (let j = goalFrameIdx - 1; j >= goalFrameIdx - lookback; j--) {
    const f = frames[j];
    if (f.ball.phase !== 'possessed' || !f.ball.carrierId) continue;

    // Find the carrier's team
    const carrier = f.players.find(p => p.playerId === f.ball.carrierId);
    if (!carrier || carrier.team !== team) continue;

    if (!scorerId) {
      scorerId = f.ball.carrierId;
    } else if (f.ball.carrierId !== scorerId && !assisterId) {
      assisterId = f.ball.carrierId;
      break;
    }
  }

  return { scorerId, assisterId };
}

/**
 * Detect priority interactions: moments with multiple players near the ball.
 */
export function detectPriorityInteractions(
  frames: FrameState[],
): PriorityInteraction[] {
  const interactions: PriorityInteraction[] = [];
  const proximityThreshold = 0.05;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frame.ball.confidence < 0.3) continue;

    const nearbyPlayers = frame.players
      .map(p => ({
        player: p,
        dist: Math.hypot(
          p.position.x - frame.ball.position.x,
          p.position.y - frame.ball.position.y,
        ),
      }))
      .filter(({ dist }) => dist < proximityThreshold);

    // Need players from both teams near ball
    const hasOur = nearbyPlayers.some(({ player: p }) => p.team === 'our_team');
    const hasOpp = nearbyPlayers.some(({ player: p }) => p.team === 'opp_team');

    if (hasOur && hasOpp && nearbyPlayers.length >= 2) {
      // Determine winner: player who has ball in next frame (or closest)
      const nextFrame = i + 1 < frames.length ? frames[i + 1] : null;
      const winnerId = nextFrame?.ball.carrierId ?? frame.ball.carrierId;

      interactions.push({
        frameNumber: frame.frameNumber,
        timestamp: frame.timestampSeconds,
        contestingPlayers: nearbyPlayers.map(({ player: p, dist }) => ({
          playerId: p.playerId,
          team: p.team,
          queuedAction: p.currentAction,
          distanceToBall: dist,
          won: p.playerId === winnerId,
        })),
        ballPhaseAfter: nextFrame?.ball.phase ?? frame.ball.phase,
        outcome: winnerId
          ? `${winnerId} wins possession`
          : 'contested',
      });
    }
  }

  return interactions;
}
