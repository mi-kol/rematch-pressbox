/**
 * Stage 2: Detection
 *
 * - Parses minimap to detect player/ball markers
 * - Extracts scorebug data (time, score, team colors)
 * - Detects viewport indicators (pass targets, shot charging, etc.)
 */

import type {
  MinimapDetection,
  ScorebugData,
  FrameState,
  GameState,
} from '../types.js';
import { extractScorebugColors, type ScoreFilterState } from '../cv/scorebug.js';
import { parseMinimap } from '../cv/minimap.js';
import { detectNametags, type NametagDetection } from '../cv/viewport.js';
import type { ResolutionConfig } from '../config.js';

export interface DetectionOptions {
  config: ResolutionConfig;
  teamColors?: {
    ours: { h: number; s: number; v: number };
    opponent: { h: number; s: number; v: number };
  };
  fieldLineMask?: Uint8Array;
  backgroundMask?: Uint8Array;
  /** Enable nametag OCR detection (expensive — run selectively). */
  detectNametags?: boolean;
  /** Score filter state for temporal smoothing. */
  scoreFilterState?: ScoreFilterState;
}

export interface FrameDetection {
  frameNumber: number;
  timestampSeconds: number;
  minimap: MinimapDetection | null;
  scorebug: ScorebugData | null;
  nametags: NametagDetection[];
}

/**
 * Detect all elements in a single frame.
 */
export async function detectFrame(
  framePath: string,
  frameNumber: number,
  timestampSeconds: number,
  options: DetectionOptions
): Promise<FrameDetection> {
  let scorebug: ScorebugData | null = null;
  let minimap: MinimapDetection | null = null;
  let nametags: NametagDetection[] = [];

  try {
    scorebug = await extractScorebugColors(framePath, options.config, options.scoreFilterState);
  } catch (err) {
    console.error(`[detect] Scorebug extraction failed for frame ${frameNumber}:`, err);
  }

  if (options.teamColors) {
    try {
      minimap = await parseMinimap(framePath, {
        config: options.config,
        ourColor: options.teamColors.ours,
        oppColor: options.teamColors.opponent,
        fieldLineMask: options.fieldLineMask,
        backgroundMask: options.backgroundMask,
      });
    } catch (err) {
      console.error(`[detect] Minimap detection failed for frame ${frameNumber}:`, err);
    }

    if (options.detectNametags) {
      try {
        nametags = await detectNametags(framePath, options.config, options.teamColors);
      } catch (err) {
        console.error(`[detect] Nametag detection failed for frame ${frameNumber}:`, err);
      }
    }
  }

  return {
    frameNumber,
    timestampSeconds,
    minimap,
    scorebug,
    nametags,
  };
}

/**
 * Convert raw detections to frame state.
 * TODO: Implement full conversion with player tracking context
 */
export function detectionToFrameState(
  detection: FrameDetection,
  _previousFrame: FrameState | null
): Partial<FrameState> {
  const gameState: Partial<GameState> = {};

  if (detection.scorebug) {
    gameState.timeRemaining = detection.scorebug.timeRemaining;
    gameState.timeRemainingSeconds = detection.scorebug.timeRemainingSeconds;
    gameState.scoreOurs = detection.scorebug.scoreOurs;
    gameState.scoreOpponent = detection.scorebug.scoreOpponent;
    gameState.ourTeamColor = detection.scorebug.ourTeamColor;
    gameState.oppTeamColor = detection.scorebug.oppTeamColor;
  }

  return {
    frameNumber: detection.frameNumber,
    timestampSeconds: detection.timestampSeconds,
    gameState: gameState as GameState,
    minimapRaw: detection.minimap,
  };
}
