/**
 * Integration test: fusion pipeline.
 *
 * Extracts frames from RematchFullGame.mp4, runs detection + tracking + fusion,
 * and prints name assignments with track IDs and POV identification.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { CONFIG_1080P } from '../../dist/config.js';
import { extractScorebugColors } from '../../dist/cv/scorebug.js';
import { buildMinimapBackground, extractMinimapHsv, subtractBackground } from '../../dist/cv/minimap-bg.js';
import { detectFrame } from '../../dist/pipeline/detect.js';
import { createTrackingContext, updateTracking } from '../../dist/pipeline/track.js';
import { fuseDetections } from '../../dist/pipeline/fuse.js';
import { createIdentityContext, registerTrack, addNameObservation, getRoster } from '../../dist/tracking/identity.js';
import { createBallContext, updateBallState } from '../../dist/ball/stateMachine.js';

const VIDEO = '../../.claude/RematchFullGame.mp4';
const config = CONFIG_1080P;
const fps = 5;
const startSec = 30;     // skip intro
const numFrames = 50;    // analyze 50 frames (10 seconds)
const nametagInterval = 5;

// Create temp dirs
const framesDir = '../../output/test-fusion/frames';
const bgDir = '../../output/test-fusion/bg';
fs.mkdirSync(framesDir, { recursive: true });
fs.mkdirSync(bgDir, { recursive: true });

// Extract frames
console.log(`Extracting ${numFrames} frames from t=${startSec}s...`);
execSync(
  `ffmpeg -y -ss ${startSec} -i "${VIDEO}" -vf fps=${fps} -frames:v ${numFrames} "${path.join(framesDir, 'frame_%04d.png')}" -loglevel warning`,
  { stdio: 'inherit' }
);

// Extract background frames (30 frames at 0.5fps = 60s span)
console.log('Extracting background frames...');
execSync(
  `ffmpeg -y -ss 15 -i "${VIDEO}" -t 120 -vf fps=0.5 "${path.join(bgDir, 'bg_%04d.png')}" -loglevel warning`,
  { stdio: 'inherit' }
);

const frameFiles = fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
const bgFiles = fs.readdirSync(bgDir).filter(f => f.endsWith('.png')).sort();
const bgPaths = bgFiles.map(f => path.join(bgDir, f));

// Build background model
console.log(`Building background model from ${bgPaths.length} frames...`);
const background = await buildMinimapBackground(bgPaths, config);

// Get team colors
const firstFrame = path.join(framesDir, frameFiles[0]);
const scorebug = await extractScorebugColors(firstFrame, config);
const teamColors = { ours: scorebug.ourTeamColor, opponent: scorebug.oppTeamColor };
console.log(`Our:  H=${teamColors.ours.h.toFixed(0)} S=${teamColors.ours.s.toFixed(0)} V=${teamColors.ours.v.toFixed(0)}`);
console.log(`Opp:  H=${teamColors.opponent.h.toFixed(0)} S=${teamColors.opponent.s.toFixed(0)} V=${teamColors.opponent.v.toFixed(0)}`);

// Init tracking + identity + ball
const trackingCtx = createTrackingContext(teamColors.ours, teamColors.opponent);
const identityCtx = createIdentityContext();
const ballCtx = createBallContext();

console.log(`\nProcessing ${frameFiles.length} frames (nametag OCR every ${nametagInterval}th)...\n`);

let totalAssignments = 0;

for (let i = 0; i < frameFiles.length; i++) {
  const framePath = path.join(framesDir, frameFiles[i]);
  const frameNumber = i + 1;
  const ts = startSec + i / fps;

  const frameHsv = await extractMinimapHsv(framePath, config);
  const bgMask = subtractBackground(frameHsv.hsv, background);

  const runNametags = frameNumber % nametagInterval === 0;
  const detection = await detectFrame(framePath, frameNumber, ts, {
    config,
    teamColors,
    backgroundMask: bgMask,
    detectNametags: runNametags,
  });

  // Inject POV marker if needed
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
      });
    }
  }

  const playerStates = updateTracking(trackingCtx, markers, frameNumber, fps);

  // Ball state machine
  const ballState = updateBallState(
    ballCtx,
    detection.minimap?.ballMarker?.position ?? null,
    detection.minimap?.ballTargetMarker?.position ?? null,
    playerStates,
    frameNumber,
    fps,
  );

  for (const p of playerStates) {
    registerTrack(identityCtx, p.playerId, p.team);
  }

  const cameraHeading = detection.minimap?.povArrowAngle ?? null;
  const fusion = fuseDetections(playerStates, detection.nametags, cameraHeading, config);

  for (const a of fusion.nameAssignments) {
    addNameObservation(identityCtx, a.trackId, a.name, a.confidence);
    totalAssignments++;
  }

  // Log
  const our = playerStates.filter(p => p.team === 'our_team').length;
  const opp = playerStates.filter(p => p.team === 'opp_team').length;
  const assignStr = fusion.nameAssignments.length > 0
    ? ` → ${fusion.nameAssignments.map(a => `"${a.name}"→${a.trackId}(${(a.confidence*100).toFixed(0)}%)`).join(', ')}`
    : '';
  const povStr = fusion.povTrackId ? ` [POV=${fusion.povTrackId}]` : '';
  const ntDet = detection.nametags.length > 0
    ? ` nt_raw=${detection.nametags.map(n => `"${n.text}"[${n.team}]`).join(',')}`
    : '';

  const ballStr = ` ball=${ballState.phase}${ballState.carrierId ? '(' + ballState.carrierId + ')' : ''}`;

  console.log(
    `Frame ${String(frameNumber).padStart(3)}: ` +
    `${String(markers.length).padStart(2)} mkr → ${String(playerStates.length).padStart(2)} trk (${our}+${opp})` +
    ballStr +
    ` heading=${cameraHeading != null ? cameraHeading.toFixed(2) : 'null'}` +
    povStr + ntDet + assignStr
  );
}

// Final roster
console.log('\n=== Identity Roster ===');
const roster = getRoster(identityCtx);
for (const [trackId, info] of roster) {
  const identity = identityCtx.identities.get(trackId);
  const obs = identity ? Array.from(identity.nameObservations.entries()) : [];
  const obsStr = obs.map(([name, score]) => `"${name}":${score.toFixed(2)}`).join(', ');
  console.log(`  ${trackId} (${info.team}): "${info.displayName}" — observations: {${obsStr}}`);
}

console.log(`\nTotal name assignments: ${totalAssignments}`);
console.log(`Total tracks: ${roster.size}`);
