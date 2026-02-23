/**
 * Rematch Video Parser
 *
 * Full pipeline: extract → background → scorebug → detect → track → output
 *
 * Extracts game state from POV footage:
 * - Player positions from minimap (background subtraction + pixel classification)
 * - Ball state and trajectory
 * - Game events (goals, tackles, passes)
 * - Team identification via scorebug colors
 */

import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';
import { extractFrames, getVideoMetadata } from './pipeline/extract.js';
import { detectFrame } from './pipeline/detect.js';
import { createTrackingContext, updateTracking } from './pipeline/track.js';
import { fuseDetections } from './pipeline/fuse.js';
import { buildMinimapBackground, extractMinimapHsv, subtractBackground } from './cv/minimap-bg.js';
import { extractScorebugColors, createScoreFilterState, initScoreWorker, terminateScoreWorker } from './cv/scorebug.js';
import { createIdentityContext, registerTrack, addNameObservation, getRoster, setKnownNames } from './tracking/identity.js';
import { createBallContext, updateBallState } from './ball/stateMachine.js';
import { detectGoals, detectPriorityInteractions } from './pipeline/enrich.js';
import { parseRosterScreen } from './cv/roster.js';
import { CONFIG_1080P, getConfigForResolution, PROCESSING } from './config.js';
import type { MatchData, FrameState, MinimapMarker, RosterScreenData } from './types.js';

export interface ParseOptions {
  inputVideo: string;
  outputDir: string;
  fps?: number;
  /** Seconds to skip at start (pre-game animation). Default 15. */
  startTime?: number;
  duration?: number;
  /** Background sampling duration in seconds. Default 120. */
  bgDuration?: number;
  /** Background sampling rate in fps. Default 0.5. */
  bgFps?: number;
  /** POV player's in-game name (used to determine which roster side is ours). */
  povPlayerName?: string;
}

/**
 * Parse a Rematch video file.
 */
export async function parseVideo(options: ParseOptions): Promise<MatchData> {
  const {
    inputVideo,
    outputDir,
    fps = PROCESSING.defaultSampleFps,
    startTime = 15,
    duration,
    bgDuration = 120,
    bgFps = 0.5,
  } = options;

  console.log('[parser] Starting video analysis...');
  console.log(`[parser] Input: ${inputVideo}`);

  // Get video metadata
  const metadata = await getVideoMetadata(inputVideo);
  const config = getConfigForResolution(metadata.width, metadata.height);
  console.log(`[parser] Video: ${metadata.width}x${metadata.height} @ ${metadata.fps.toFixed(1)}fps, ${metadata.duration.toFixed(1)}s`);

  // Create output directories
  const framesDir = path.join(outputDir, 'frames');
  const bgFramesDir = path.join(outputDir, 'bg_frames');
  await fs.mkdir(framesDir, { recursive: true });
  await fs.mkdir(bgFramesDir, { recursive: true });

  // --- Stage 0: Roster screen OCR ---
  console.log('\n[parser] Stage 0: Scanning for roster screen...');
  const rosterFramesDir = path.join(outputDir, 'roster_frames');
  await fs.mkdir(rosterFramesDir, { recursive: true });

  let rosterData: RosterScreenData | null = null;
  try {
    // Extract 5 frames from intro (t=3s to t=8s) at 1fps
    execSync(
      `ffmpeg -y -ss 3 -i "${inputVideo}" -t 5 -vf fps=1 "${path.join(rosterFramesDir, 'roster_%02d.png')}" -loglevel warning`,
      { stdio: 'inherit' }
    );
    const rosterFiles = (await fs.readdir(rosterFramesDir))
      .filter(f => f.startsWith('roster_') && f.endsWith('.png'))
      .sort();

    // Try all roster frames, keep the one with highest average confidence
    let bestConfidence = 0;
    for (const file of rosterFiles) {
      const rosterFramePath = path.join(rosterFramesDir, file);
      const result = await parseRosterScreen(rosterFramePath, config, options.povPlayerName);
      if (result) {
        const allEntries = [...result.ourTeam, ...result.oppTeam];
        const avgConf = allEntries.reduce((s, e) => s + e.confidence, 0) / allEntries.length;
        console.log(`[parser] Roster candidate in ${file}: ${allEntries.length} names, avg conf=${(avgConf * 100).toFixed(0)}%`);
        if (avgConf > bestConfidence) {
          bestConfidence = avgConf;
          rosterData = result;
        }
      }
    }
    if (rosterData) {
      console.log(`[parser] Best roster (from ${path.basename(rosterData.frameUsed)}):`);
      console.log(`  Our team: ${rosterData.ourTeam.map(e => e.name).join(', ')}`);
      console.log(`  Opponent: ${rosterData.oppTeam.map(e => e.number ? `${e.name}(#${e.number})` : e.name).join(', ')}`);
    }
    if (!rosterData) {
      console.log('[parser] No roster screen detected in intro frames');
    }
  } catch (err) {
    console.log('[parser] Roster scan failed (non-fatal):', (err as Error).message);
  }

  // --- Stage 1: Extract frames ---
  console.log('\n[parser] Stage 1: Extracting frames...');
  const extraction = await extractFrames({
    inputPath: inputVideo,
    outputDir: framesDir,
    fps,
    startTime,
    duration,
  });

  // --- Stage 1b: Extract background frames ---
  console.log(`[parser] Extracting background frames (${bgFps}fps across ${bgDuration}s)...`);
  const actualBgDuration = Math.min(bgDuration, metadata.duration - startTime);
  execSync(
    `ffmpeg -y -ss ${startTime} -i "${inputVideo}" -t ${actualBgDuration} -vf fps=${bgFps} "${path.join(bgFramesDir, 'bg_%04d.png')}" -loglevel warning`,
    { stdio: 'inherit' }
  );
  const bgFileList = (await fs.readdir(bgFramesDir))
    .filter(f => f.startsWith('bg_') && f.endsWith('.png'))
    .sort();
  const bgPaths = bgFileList.map(f => path.join(bgFramesDir, f));
  console.log(`[parser] ${bgPaths.length} background frames extracted`);

  // --- Stage 2: Build background model ---
  console.log('\n[parser] Stage 2: Building minimap background model...');
  const background = await buildMinimapBackground(bgPaths, config);
  console.log(`[parser] Background: ${background.width}x${background.height} from ${bgPaths.length} frames`);

  // --- Stage 3: Get team colors from first gameplay frame ---
  console.log('\n[parser] Stage 3: Extracting team colors from scorebug...');
  const firstFramePath = extraction.frames[0]?.path;
  if (!firstFramePath) {
    throw new Error('No frames extracted — check video path and startTime');
  }
  const scorebug = await extractScorebugColors(firstFramePath, config);
  const teamColors = {
    ours: scorebug.ourTeamColor,
    opponent: scorebug.oppTeamColor,
  };
  console.log(`[parser] Our:  H=${teamColors.ours.h.toFixed(0)} S=${teamColors.ours.s.toFixed(0)} V=${teamColors.ours.v.toFixed(0)}`);
  console.log(`[parser] Opp:  H=${teamColors.opponent.h.toFixed(0)} S=${teamColors.opponent.s.toFixed(0)} V=${teamColors.opponent.v.toFixed(0)}`);

  // --- Stage 4: Detect + track each frame ---
  const trackingCtx = createTrackingContext(teamColors.ours, teamColors.opponent);
  const identityCtx = createIdentityContext();
  const ballCtx = createBallContext();

  // Seed identity system with roster names for fuzzy matching
  if (rosterData) {
    const allNames = [
      ...rosterData.ourTeam.map(e => e.name),
      ...rosterData.oppTeam.map(e => e.name),
    ];
    setKnownNames(identityCtx, allNames);
    console.log(`[parser] Seeded identity system with ${allNames.length} roster names`);
  }
  // Initialize score filter with singleton Tesseract worker
  const scoreFilter = createScoreFilterState();
  await initScoreWorker(scoreFilter);

  const NAMETAG_INTERVAL = 5; // Run nametag OCR every Nth frame
  const ROSTER_CHECK_FRAME = 50; // Cross-reference roster teams after this many frames
  let rosterChecked = false;
  /** Accumulates (name, team) from nametag detections for roster cross-reference. */
  const nameTeamAccumulator: Array<{ name: string; team: 'our_team' | 'opp_team' | 'unknown' }> = [];

  console.log(`\n[parser] Stage 4: Detect → track (${extraction.frames.length} frames)...\n`);
  const frames: FrameState[] = [];
  let nametagTotal = 0;

  for (const frame of extraction.frames) {
    const { path: framePath, frameNumber, timestampSeconds } = frame;

    // Background subtraction
    const frameHsv = await extractMinimapHsv(framePath, config);
    const bgMask = subtractBackground(frameHsv.hsv, background);

    // Detect minimap markers + nametags (nametags every Nth frame)
    const runNametags = frameNumber % NAMETAG_INTERVAL === 0;
    const detection = await detectFrame(framePath, frameNumber, timestampSeconds, {
      config,
      teamColors,
      backgroundMask: bgMask,
      detectNametags: runNametags,
      scoreFilterState: scoreFilter,
    });

    // Inject synthetic POV marker at minimap center so POV player gets tracked.
    // The POV arrow (white) is excluded from player markers, so without this
    // the POV player would have no track.
    const markers = detection.minimap?.markers ? [...detection.minimap.markers] : [];
    if (detection.minimap?.povArrowAngle != null) {
      const hasCenterMarker = markers.some(m =>
        m.team === 'our_team' &&
        Math.hypot(m.position.x - 0.5, m.position.y - 0.5) < 0.06
      );
      if (!hasCenterMarker) {
        markers.push({
          position: { x: 0.5, y: 0.5 },
          color: teamColors.ours,
          shape: 'circle',
          team: 'our_team',
          confidence: 0.9,
          radiusPixels: 5,
        } satisfies MinimapMarker);
      }
    }

    // Track players
    const playerStates = updateTracking(trackingCtx, markers, frameNumber, fps);

    // Register tracks with identity system
    for (const p of playerStates) {
      registerTrack(identityCtx, p.playerId, p.team);
    }

    // Fuse nametags with tracked players (bind names to track IDs)
    const cameraHeading = detection.minimap?.povArrowAngle ?? null;
    const fusion = fuseDetections(playerStates, detection.nametags, cameraHeading, config);

    // Feed name observations into identity voting
    for (const assignment of fusion.nameAssignments) {
      addNameObservation(identityCtx, assignment.trackId, assignment.name, assignment.confidence);
      nametagTotal++;

      // Accumulate name+team for roster cross-reference
      const track = playerStates.find(p => p.playerId === assignment.trackId);
      if (track) {
        nameTeamAccumulator.push({ name: assignment.name.toLowerCase(), team: track.team });
      }
    }

    // Roster team cross-reference: check if HOME/AWAY labels are swapped
    if (rosterData && !rosterChecked && frameNumber >= ROSTER_CHECK_FRAME && nameTeamAccumulator.length > 0) {
      rosterChecked = true;
      const homeNames = new Set(rosterData.ourTeam.map(e => e.name.toLowerCase()));
      let homeInOurTeam = 0;
      let homeInOppTeam = 0;

      for (const entry of nameTeamAccumulator) {
        if (homeNames.has(entry.name)) {
          if (entry.team === 'our_team') homeInOurTeam++;
          else if (entry.team === 'opp_team') homeInOppTeam++;
        }
      }

      if (homeInOppTeam > homeInOurTeam * 2 && homeInOppTeam >= 3) {
        // HOME roster names appear predominantly as opp_team nametags → swap
        const temp = rosterData.ourTeam;
        rosterData.ourTeam = rosterData.oppTeam;
        rosterData.oppTeam = temp;

        // Re-seed identity system with corrected teams
        const allNames = [
          ...rosterData.ourTeam.map(e => e.name),
          ...rosterData.oppTeam.map(e => e.name),
        ];
        setKnownNames(identityCtx, allNames);
        console.log(`[parser] Roster teams SWAPPED (HOME = opponent, detected from ${homeInOppTeam} vs ${homeInOurTeam} nametag matches)`);
      } else {
        console.log(`[parser] Roster team assignment confirmed (HOME in our_team: ${homeInOurTeam}, in opp_team: ${homeInOppTeam})`);
      }
    }

    // Mark POV player
    if (fusion.povTrackId) {
      const povPlayer = playerStates.find(p => p.playerId === fusion.povTrackId);
      if (povPlayer) povPlayer.isPovPlayer = true;
    }

    // Ball state machine
    const ballState = updateBallState(
      ballCtx,
      detection.minimap?.ballMarker?.position ?? null,
      detection.minimap?.ballTargetMarker?.position ?? null,
      playerStates,
      frameNumber,
      fps,
    );

    // Mark ball carrier
    if (ballState.carrierId && ballState.phase === 'possessed') {
      const carrier = playerStates.find(p => p.playerId === ballState.carrierId);
      if (carrier) carrier.hasBall = true;
    }

    // Build FrameState
    frames.push({
      frameNumber,
      timestampSeconds,
      gameState: {
        timeRemaining: detection.scorebug?.timeRemaining || '00:00',
        timeRemainingSeconds: detection.scorebug?.timeRemainingSeconds || 0,
        scoreOurs: detection.scorebug?.scoreOurs || 0,
        scoreOpponent: detection.scorebug?.scoreOpponent || 0,
        phase: 'gameplay',
        phaseConfidence: 0.5,
        ourTeamColor: teamColors.ours,
        oppTeamColor: teamColors.opponent,
      },
      players: playerStates,
      ball: ballState,
      povPlayerId: fusion.povTrackId || 'unknown',
      cameraHeading: cameraHeading || 0,
      minimapRaw: detection.minimap,
    });

    // Progress
    const fgPx = bgMask.reduce((s, v) => s + (v === 0 ? 1 : 0), 0);
    const our = playerStates.filter(p => p.team === 'our_team').length;
    const opp = playerStates.filter(p => p.team === 'opp_team').length;
    const interp = playerStates.filter(p => p.source === 'interpolated').length;
    const ntCount = fusion.nameAssignments.length;
    const ntStr = ntCount > 0
      ? ` nt=${ntCount}(${fusion.nameAssignments.map(a => `${a.name}→${a.trackId}`).join(',')})`
      : '';
    const povStr = fusion.povTrackId ? ` pov=${fusion.povTrackId}` : '';
    console.log(
      `  Frame ${String(frameNumber).padStart(3)}: ` +
      `${String(fgPx).padStart(6)} fg → ` +
      `${String(markers.length).padStart(2)} mkr → ` +
      `${String(playerStates.length).padStart(2)} trk ` +
      `(${our}+${opp}${interp ? ` ${interp}i` : ''}) ` +
      `ball=${ballState.phase}${ballState.carrierId ? '(' + ballState.carrierId + ')' : ''}` +
      ntStr + povStr
    );
  }

  // Clean up singleton workers
  await terminateScoreWorker(scoreFilter);

  // --- Stage 5: Build output ---
  console.log('\n[parser] Stage 5: Building output...');

  // Build roster from identity voting + tracking
  const identityRoster = getRoster(identityCtx);
  const playerRoster: MatchData['playerRoster'] = {};
  for (const f of frames) {
    for (const p of f.players) {
      if (!playerRoster[p.playerId]) {
        const identity = identityRoster.get(p.playerId);
        playerRoster[p.playerId] = {
          displayName: identity?.displayName || p.playerId,
          team: p.team,
          firstSeen: f.frameNumber,
        };
      }
    }
  }

  // Enrichment: goals + priority interactions
  const goals = detectGoals(frames);
  const priorityInteractions = detectPriorityInteractions(frames);
  if (goals.length > 0) {
    console.log(`[parser] Goals detected: ${goals.length}`);
    for (const g of goals) {
      console.log(`  Frame ${g.frameNumber}: ${g.team} scores (${g.scoreAfter.ours}-${g.scoreAfter.opponent})${g.scorerId ? ' scorer=' + g.scorerId : ''}`);
    }
  }

  const matchData: MatchData = {
    frames,
    sourceFps: extraction.metadata.sourceFps,
    sampleFps: extraction.metadata.sampleFps,
    playerRoster,
    priorityInteractions,
    goals,
    rosterScreen: rosterData ?? undefined,
    metadata: {
      mapName: null,
      matchDuration: metadata.duration,
      recordingResolution: { width: metadata.width, height: metadata.height },
      sourceFile: inputVideo,
    },
  };

  // Save match.json
  const matchJsonPath = path.join(outputDir, 'match.json');
  await fs.writeFile(matchJsonPath, JSON.stringify(matchData, null, 2));
  console.log(`[parser] match.json: ${frames.length} frames, ${Object.keys(playerRoster).length} players, ${nametagTotal} name observations`);

  // Log identity roster
  const rosterEntries = Object.entries(playerRoster);
  if (rosterEntries.length > 0) {
    console.log('[parser] Player roster:');
    for (const [id, info] of rosterEntries) {
      console.log(`  ${id}: "${info.displayName}" (${info.team}, first seen frame ${info.firstSeen})`);
    }
  }

  // Compact viewer format
  const trackingData = {
    meta: {
      video: path.basename(inputVideo),
      fps,
      startSec: startTime,
      frameCount: frames.length,
      teamColors,
      score: { ours: scorebug.scoreOurs, opponent: scorebug.scoreOpponent },
      minimapSize: { width: background.width, height: background.height },
    },
    frames: frames.map(f => ({
      frameIndex: f.frameNumber,
      timestamp: f.timestampSeconds,
      players: f.players.map(p => {
        const identity = identityRoster.get(p.playerId);
        return {
          id: p.playerId,
          name: identity?.displayName !== `Player_${p.playerId}` ? identity?.displayName : undefined,
          team: p.team,
          x: +p.position.x.toFixed(4),
          y: +p.position.y.toFixed(4),
          vx: +p.velocity.dx.toFixed(4),
          vy: +p.velocity.dy.toFixed(4),
          confidence: +p.confidence.toFixed(3),
          source: p.source,
          action: p.currentAction !== 'unknown' ? p.currentAction : undefined,
          hasBall: p.hasBall || undefined,
          pov: p.isPovPlayer || undefined,
        };
      }),
      ball: f.ball.confidence > 0 ? {
        x: +f.ball.position.x.toFixed(4),
        y: +f.ball.position.y.toFixed(4),
        phase: f.ball.phase,
        carrier: f.ball.carrierId || undefined,
      } : null,
      rawMarkerCount: f.minimapRaw?.markers.length || 0,
    })),
  };

  const trackingJsonPath = path.join(outputDir, 'tracking_data.json');
  await fs.writeFile(trackingJsonPath, JSON.stringify(trackingData, null, 2));
  console.log(`[parser] tracking_data.json: ${JSON.stringify(trackingData).length} bytes`);

  console.log(`\n[parser] Done! Output: ${outputDir}`);
  return matchData;
}

// Re-export types and utilities
export * from './types.js';
export * from './config.js';
export { extractScorebugColors, debugSaveSwatchRegions } from './cv/scorebug.js';

// CLI entry point
if (process.argv[1] && process.argv[1].includes('index')) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: node index.js <video_path> [output_dir] [--start N] [--duration N] [--fps N] [--pov NAME]');
    process.exit(1);
  }

  if (args[0] === '--test-scorebug' && args[1]) {
    const { extractScorebugColors: extract, debugSaveSwatchRegions: debug } = await import('./cv/scorebug.js');
    console.log('Testing scorebug on:', args[1]);
    await debug(args[1], CONFIG_1080P, './output/debug');
    const result = await extract(args[1], CONFIG_1080P);
    console.log('Result:', JSON.stringify(result, null, 2));
  } else {
    const videoPath = args[0];
    const outputDir = args[1] || './output';

    let startTime = 15;
    let duration: number | undefined;
    let fpsCli = 5;
    let povName: string | undefined;
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--start' && args[i + 1]) startTime = parseFloat(args[++i]);
      if (args[i] === '--duration' && args[i + 1]) duration = parseFloat(args[++i]);
      if (args[i] === '--fps' && args[i + 1]) fpsCli = parseFloat(args[++i]);
      if (args[i] === '--pov' && args[i + 1]) povName = args[++i];
    }

    await parseVideo({ inputVideo: videoPath, outputDir, fps: fpsCli, startTime, duration, povPlayerName: povName });
  }
}
