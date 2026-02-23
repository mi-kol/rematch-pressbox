/**
 * End-to-end integration test: roster OCR → tracking → identity.
 *
 * Exercises the full pipeline:
 * 1. Extract roster frames from intro (t=3-8s)
 * 2. Detect + OCR roster screen
 * 3. Seed identity system with roster names
 * 4. Run detection + tracking + fusion for 20 frames
 * 5. Verify roster names flow through to final player roster
 *
 * Run: node tests/integration/test-e2e-roster.mjs [video_path]
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { CONFIG_1080P } from '../../dist/config.js';
import { parseRosterScreen } from '../../dist/cv/roster.js';
import { extractScorebugColors } from '../../dist/cv/scorebug.js';
import { buildMinimapBackground, extractMinimapHsv, subtractBackground } from '../../dist/cv/minimap-bg.js';
import { detectFrame } from '../../dist/pipeline/detect.js';
import { createTrackingContext, updateTracking } from '../../dist/pipeline/track.js';
import { fuseDetections } from '../../dist/pipeline/fuse.js';
import { createIdentityContext, registerTrack, addNameObservation, getRoster, setKnownNames } from '../../dist/tracking/identity.js';
import { createBallContext, updateBallState } from '../../dist/ball/stateMachine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = process.argv[2] || path.join(__dirname, '../../.claude', 'RematchFullGame.mp4');
const config = CONFIG_1080P;
const fps = 5;
const startSec = 20;
const numFrames = 20;
const nametagInterval = 5;

console.log('=== E2E Roster Integration Test ===\n');

if (!fs.existsSync(VIDEO)) {
  console.log(`Video not found: ${VIDEO}`);
  console.log('Skipping E2E test (requires video file)');
  process.exit(0);
}

// --- Stage 0: Roster screen OCR ---
console.log('Stage 0: Extracting roster frames...');
const rosterDir = path.join(__dirname, '../../output/e2e-roster/roster_frames');
const framesDir = path.join(__dirname, '../../output/e2e-roster/frames');
const bgDir = path.join(__dirname, '../../output/e2e-roster/bg');
fs.mkdirSync(rosterDir, { recursive: true });
fs.mkdirSync(framesDir, { recursive: true });
fs.mkdirSync(bgDir, { recursive: true });

execSync(
  `ffmpeg -y -ss 3 -i "${VIDEO}" -t 5 -vf fps=1 "${path.join(rosterDir, 'roster_%02d.png')}" -loglevel warning`,
  { stdio: 'inherit' }
);

const rosterFiles = fs.readdirSync(rosterDir).filter(f => f.endsWith('.png')).sort();
console.log(`  Extracted ${rosterFiles.length} roster frames`);

let rosterData = null;
for (const file of rosterFiles) {
  const framePath = path.join(rosterDir, file);
  rosterData = await parseRosterScreen(framePath, config);
  if (rosterData) {
    console.log(`  Roster found in ${file}:`);
    console.log(`    Our team (${rosterData.ourTeam.length}): ${rosterData.ourTeam.map(e => e.name).join(', ')}`);
    console.log(`    Opponent (${rosterData.oppTeam.length}): ${rosterData.oppTeam.map(e => e.number ? `${e.name}(#${e.number})` : e.name).join(', ')}`);
    break;
  }
}

if (!rosterData) {
  console.log('  No roster screen detected (this is expected if intro layout varies)');
  console.log('  Continuing without roster seeding...\n');
}

// --- Stage 1: Extract gameplay + background frames ---
console.log('\nStage 1: Extracting gameplay frames...');
execSync(
  `ffmpeg -y -ss ${startSec} -i "${VIDEO}" -vf fps=${fps} -frames:v ${numFrames} "${path.join(framesDir, 'frame_%04d.png')}" -loglevel warning`,
  { stdio: 'inherit' }
);
execSync(
  `ffmpeg -y -ss 15 -i "${VIDEO}" -t 60 -vf fps=0.5 "${path.join(bgDir, 'bg_%04d.png')}" -loglevel warning`,
  { stdio: 'inherit' }
);

const frameFiles = fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
const bgPaths = fs.readdirSync(bgDir).filter(f => f.endsWith('.png')).sort().map(f => path.join(bgDir, f));
console.log(`  ${frameFiles.length} gameplay frames, ${bgPaths.length} bg frames`);

// --- Stage 2: Background model + team colors ---
console.log('\nStage 2: Building background model...');
const background = await buildMinimapBackground(bgPaths, config);
const scorebug = await extractScorebugColors(path.join(framesDir, frameFiles[0]), config);
const teamColors = { ours: scorebug.ourTeamColor, opponent: scorebug.oppTeamColor };
console.log(`  Our:  H=${teamColors.ours.h.toFixed(0)} S=${teamColors.ours.s.toFixed(0)} V=${teamColors.ours.v.toFixed(0)}`);
console.log(`  Opp:  H=${teamColors.opponent.h.toFixed(0)} S=${teamColors.opponent.s.toFixed(0)} V=${teamColors.opponent.v.toFixed(0)}`);

// --- Stage 3: Init tracking + identity ---
const trackingCtx = createTrackingContext(teamColors.ours, teamColors.opponent);
const identityCtx = createIdentityContext();
const ballCtx = createBallContext();

// Seed identity system with roster names
if (rosterData) {
  const allNames = [
    ...rosterData.ourTeam.map(e => e.name),
    ...rosterData.oppTeam.map(e => e.name),
  ];
  setKnownNames(identityCtx, allNames);
  console.log(`\n  Seeded identity system with ${allNames.length} roster names: [${allNames.join(', ')}]`);
}

// --- Stage 4: Process frames ---
console.log(`\nStage 4: Processing ${frameFiles.length} frames...\n`);
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

  const markers = detection.minimap?.markers ? [...detection.minimap.markers] : [];
  if (detection.minimap?.povArrowAngle != null) {
    const hasCenterMarker = markers.some(m =>
      m.team === 'our_team' && Math.hypot(m.position.x - 0.5, m.position.y - 0.5) < 0.06
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
  for (const p of playerStates) registerTrack(identityCtx, p.playerId, p.team);

  const cameraHeading = detection.minimap?.povArrowAngle ?? null;
  const fusion = fuseDetections(playerStates, detection.nametags, cameraHeading, config);

  for (const a of fusion.nameAssignments) {
    addNameObservation(identityCtx, a.trackId, a.name, a.confidence);
    totalAssignments++;
  }

  const ballState = updateBallState(
    ballCtx,
    detection.minimap?.ballMarker?.position ?? null,
    detection.minimap?.ballTargetMarker?.position ?? null,
    playerStates,
    frameNumber,
    fps,
  );

  const our = playerStates.filter(p => p.team === 'our_team').length;
  const opp = playerStates.filter(p => p.team === 'opp_team').length;
  const assignStr = fusion.nameAssignments.length > 0
    ? ` names=[${fusion.nameAssignments.map(a => `${a.name}→${a.trackId}`).join(',')}]`
    : '';
  console.log(
    `  Frame ${String(frameNumber).padStart(2)}: ${our}+${opp} players, ` +
    `ball=${ballState.phase}${ballState.carrierId ? '(' + ballState.carrierId + ')' : ''}` +
    assignStr
  );
}

// --- Stage 5: Verify results ---
console.log('\n=== Results ===');
const roster = getRoster(identityCtx);
console.log(`\nFinal roster (${roster.size} tracks, ${totalAssignments} name observations):`);

let namedCount = 0;
let rosterMatchCount = 0;
const knownNames = rosterData
  ? [...rosterData.ourTeam.map(e => e.name), ...rosterData.oppTeam.map(e => e.name)].map(n => n.toLowerCase())
  : [];

for (const [trackId, info] of roster) {
  const isNamed = !info.displayName.startsWith('Player_');
  const matchesRoster = knownNames.includes(info.displayName.toLowerCase());
  if (isNamed) namedCount++;
  if (matchesRoster) rosterMatchCount++;

  const identity = identityCtx.identities.get(trackId);
  const obs = identity ? Array.from(identity.nameObservations.entries()) : [];
  const obsStr = obs.length > 0 ? ` votes={${obs.map(([n, s]) => `"${n}":${s.toFixed(1)}`).join(', ')}}` : '';
  const matchTag = matchesRoster ? ' [ROSTER]' : '';

  console.log(`  ${trackId} (${info.team}): "${info.displayName}"${matchTag}${obsStr}`);
}

console.log(`\n--- Summary ---`);
console.log(`  Total tracks: ${roster.size}`);
console.log(`  Named tracks: ${namedCount}/${roster.size}`);
if (rosterData) {
  console.log(`  Roster matches: ${rosterMatchCount}/${roster.size}`);
  console.log(`  Roster names available: ${knownNames.length}`);
}
console.log(`  Name observations: ${totalAssignments}`);
console.log(`\nE2E test complete.`);
