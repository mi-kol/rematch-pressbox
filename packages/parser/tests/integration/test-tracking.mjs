/**
 * Multi-frame tracking integration test.
 * Extracts frames from the video at 5fps and runs detect → track pipeline
 * with background subtraction and persistent ID tracking.
 *
 * Outputs: output/tracking_data.json — structured per-frame data for viewer consumption.
 *
 * Run with: node test-tracking.mjs [video_path] [num_frames]
 * Defaults:  .claude/later.mp4, 10 frames
 */
import { parseMinimap } from '../../dist/cv/minimap.js';
import { extractScorebugColors } from '../../dist/cv/scorebug.js';
import { createTrackingContext, updateTracking } from '../../dist/pipeline/track.js';
import { buildMinimapBackground, extractMinimapHsv, subtractBackground } from '../../dist/cv/minimap-bg.js';
import { CONFIG_1080P } from '../../dist/config.js';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = process.argv[2] || path.join(__dirname, '../../.claude', 'RematchFullGame.mp4');
const NUM_FRAMES = parseInt(process.argv[3] || '50', 10);
const FPS = 5;
const START_SEC = 20;       // Skip pre-game animation (~10s intro + kickoff sequence)
const BG_START_SEC = 15;    // Background frames also start after intro
const BG_DURATION = 120;    // Sample across 2 minutes for robust background model
const BG_FPS = 0.5;         // 1 frame every 2 seconds = ~60 frames
const FRAME_DIR = path.join(__dirname, 'output', 'tracking_frames');
const OUTPUT_JSON = path.join(__dirname, 'output', 'tracking_data.json');

// --- Step 1: Extract frames ---
console.log(`=== Tracking Integration Test ===\n`);
console.log(`Video:  ${VIDEO}`);
console.log(`Frames: ${NUM_FRAMES} at ${FPS}fps starting at ${START_SEC}s\n`);

if (!fs.existsSync(VIDEO)) {
  console.error('Video not found:', VIDEO);
  process.exit(1);
}

fs.mkdirSync(FRAME_DIR, { recursive: true });

// Clean old frames
for (const f of fs.readdirSync(FRAME_DIR)) {
  if (f.startsWith('frame_')) fs.unlinkSync(path.join(FRAME_DIR, f));
}

console.log('1. Extracting detection frames with ffmpeg...');
const duration = NUM_FRAMES / FPS;
execSync(
  `ffmpeg -y -ss ${START_SEC} -i "${VIDEO}" -t ${duration} -vf fps=${FPS} "${path.join(FRAME_DIR, 'frame_%03d.png')}" -loglevel warning`,
  { stdio: 'inherit' }
);

const frameFiles = fs.readdirSync(FRAME_DIR)
  .filter(f => f.startsWith('frame_') && f.endsWith('.png'))
  .sort()
  .slice(0, NUM_FRAMES);

console.log(`   Extracted ${frameFiles.length} detection frames`);

const framePaths = frameFiles.map(f => path.join(FRAME_DIR, f));

// Also extract background frames from a wider time range (1fps across 30s)
const BG_DIR = path.join(__dirname, 'output', 'bg_frames');
fs.mkdirSync(BG_DIR, { recursive: true });
for (const f of fs.readdirSync(BG_DIR)) {
  if (f.startsWith('bg_')) fs.unlinkSync(path.join(BG_DIR, f));
}

console.log(`   Extracting background frames (${BG_FPS}fps across ${BG_DURATION}s from ${BG_START_SEC}s)...`);
execSync(
  `ffmpeg -y -ss ${BG_START_SEC} -i "${VIDEO}" -t ${BG_DURATION} -vf fps=${BG_FPS} "${path.join(BG_DIR, 'bg_%03d.png')}" -loglevel warning`,
  { stdio: 'inherit' }
);

const bgFiles = fs.readdirSync(BG_DIR)
  .filter(f => f.startsWith('bg_') && f.endsWith('.png'))
  .sort();
const bgPaths = bgFiles.map(f => path.join(BG_DIR, f));
console.log(`   Extracted ${bgPaths.length} background frames\n`);

// --- Step 2: Get team colors from first frame ---
console.log('2. Extracting team colors from scorebug...');
const scorebug = await extractScorebugColors(framePaths[0], CONFIG_1080P);

console.log(`   Time: ${scorebug.timeRemaining} (${scorebug.timeRemainingSeconds}s)`);
console.log(`   Score: ${scorebug.scoreOurs} - ${scorebug.scoreOpponent}`);
console.log(`   Our color:  H=${scorebug.ourTeamColor.h.toFixed(0)} S=${scorebug.ourTeamColor.s.toFixed(0)} V=${scorebug.ourTeamColor.v.toFixed(0)}`);
console.log(`   Opp color:  H=${scorebug.oppTeamColor.h.toFixed(0)} S=${scorebug.oppTeamColor.s.toFixed(0)} V=${scorebug.oppTeamColor.v.toFixed(0)}\n`);

// --- Step 3: Build minimap background from wide-range frames ---
console.log('3. Building minimap background model...');
const background = await buildMinimapBackground(bgPaths, CONFIG_1080P);
console.log(`   Background: ${background.width}x${background.height} from ${bgPaths.length} frames\n`);

// --- Step 4: Initialize tracking ---
const ctx = createTrackingContext(scorebug.ourTeamColor, scorebug.oppTeamColor);

// --- Step 5: Process each frame ---
console.log('4. Running detect → track pipeline (with background subtraction)...\n');

const frames = [];

for (let i = 0; i < framePaths.length; i++) {
  const framePath = framePaths[i];
  const timestampSec = START_SEC + i / FPS;

  // Extract minimap HSV and compute background mask for this frame
  const frameHsv = await extractMinimapHsv(framePath, CONFIG_1080P);
  const bgMask = subtractBackground(frameHsv.hsv, background);
  const fgPixels = bgMask.reduce((s, v) => s + (v === 0 ? 1 : 0), 0);



  // Detect minimap markers with background mask
  const minimap = await parseMinimap(framePath, {
    config: CONFIG_1080P,
    ourColor: scorebug.ourTeamColor,
    oppColor: scorebug.oppTeamColor,
    backgroundMask: bgMask,
  });

  // Track with persistent IDs
  const playerStates = updateTracking(ctx, minimap.markers, i, FPS);

  const ourPlayers = playerStates.filter(p => p.team === 'our_team');
  const oppPlayers = playerStates.filter(p => p.team === 'opp_team');
  const interpolated = playerStates.filter(p => p.source === 'interpolated');

  console.log(
    `   Frame ${String(i).padStart(2)}: ` +
    `${String(fgPixels).padStart(5)} fg px → ` +
    `${String(minimap.markers.length).padStart(2)} markers → ` +
    `${String(playerStates.length).padStart(2)} tracked ` +
    `(${ourPlayers.length} ours, ${oppPlayers.length} opp` +
    `${interpolated.length > 0 ? `, ${interpolated.length} interp` : ''}) ` +
    `ball=${minimap.ballMarker ? 'yes' : 'no '} ` +
    `tracks=${ctx.tracks.size}`
  );

  frames.push({
    frameIndex: i,
    timestamp: timestampSec,
    frameFile: frameFiles[i],
    players: playerStates.map(p => ({
      id: p.playerId,
      team: p.team,
      x: +p.position.x.toFixed(4),
      y: +p.position.y.toFixed(4),
      vx: +p.velocity.dx.toFixed(4),
      vy: +p.velocity.dy.toFixed(4),
      confidence: +p.confidence.toFixed(3),
      source: p.source,
    })),
    ball: minimap.ballMarker ? {
      x: +minimap.ballMarker.position.x.toFixed(4),
      y: +minimap.ballMarker.position.y.toFixed(4),
    } : null,
    rawMarkerCount: minimap.markers.length,
    foregroundPixels: fgPixels,
  });
}

// --- Step 6: Write JSON output ---
const output = {
  meta: {
    video: path.basename(VIDEO),
    fps: FPS,
    startSec: START_SEC,
    frameCount: frames.length,
    teamColors: {
      ours: scorebug.ourTeamColor,
      opponent: scorebug.oppTeamColor,
    },
    score: {
      ours: scorebug.scoreOurs,
      opponent: scorebug.scoreOpponent,
    },
    minimapSize: { width: background.width, height: background.height },
  },
  frames,
};

fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2));
console.log(`\n5. Wrote ${OUTPUT_JSON}`);
console.log(`   ${frames.length} frames, ${JSON.stringify(output).length} bytes`);

// Quick summary
const allIds = new Set();
for (const f of frames) {
  for (const p of f.players) allIds.add(p.id);
}
console.log(`   ${allIds.size} unique player IDs\n`);

console.log('Done! Open tracking_data.json in your viewer.');
