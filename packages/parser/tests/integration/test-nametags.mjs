/**
 * Quick nametag detection test.
 * Extracts a few frames from the video and runs nametag detection on them.
 *
 * Run: node test-nametags.mjs [video_path] [num_frames]
 */
import { detectNametags } from '../../dist/cv/viewport.js';
import { extractScorebugColors } from '../../dist/cv/scorebug.js';
import { CONFIG_1080P } from '../../dist/config.js';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIDEO = process.argv[2] || path.join(__dirname, '../../.claude', 'RematchFullGame.mp4');
const NUM_FRAMES = parseInt(process.argv[3] || '3', 10);
const START_SEC = 20;
const FPS = 1;  // 1fps — just a few frames for testing
const FRAME_DIR = path.join(__dirname, 'output', 'nametag_frames');

console.log('=== Nametag Detection Test ===\n');
console.log(`Video:  ${VIDEO}`);
console.log(`Frames: ${NUM_FRAMES} at ${FPS}fps starting at ${START_SEC}s\n`);

if (!fs.existsSync(VIDEO)) {
  console.error('Video not found:', VIDEO);
  process.exit(1);
}

fs.mkdirSync(FRAME_DIR, { recursive: true });
for (const f of fs.readdirSync(FRAME_DIR)) {
  if (f.startsWith('nt_')) fs.unlinkSync(path.join(FRAME_DIR, f));
}

console.log('1. Extracting frames...');
const duration = NUM_FRAMES / FPS;
execSync(
  `ffmpeg -y -ss ${START_SEC} -i "${VIDEO}" -t ${duration} -vf fps=${FPS} "${path.join(FRAME_DIR, 'nt_%03d.png')}" -loglevel warning`,
  { stdio: 'inherit' }
);

const frameFiles = fs.readdirSync(FRAME_DIR)
  .filter(f => f.startsWith('nt_') && f.endsWith('.png'))
  .sort()
  .slice(0, NUM_FRAMES);

console.log(`   Extracted ${frameFiles.length} frames\n`);

// Get team colors from first frame
console.log('2. Getting team colors from scorebug...');
const firstFrame = path.join(FRAME_DIR, frameFiles[0]);
const scorebug = await extractScorebugColors(firstFrame, CONFIG_1080P);
const teamColors = {
  ours: scorebug.ourTeamColor,
  opponent: scorebug.oppTeamColor,
};
console.log(`   Our:  H=${teamColors.ours.h.toFixed(0)} S=${teamColors.ours.s.toFixed(0)} V=${teamColors.ours.v.toFixed(0)}`);
console.log(`   Opp:  H=${teamColors.opponent.h.toFixed(0)} S=${teamColors.opponent.s.toFixed(0)} V=${teamColors.opponent.v.toFixed(0)}\n`);

// Run nametag detection on each frame
console.log('3. Running nametag detection...\n');

for (let i = 0; i < frameFiles.length; i++) {
  const framePath = path.join(FRAME_DIR, frameFiles[i]);
  console.log(`--- Frame ${i + 1}: ${frameFiles[i]} ---`);

  const t0 = performance.now();
  const nametags = await detectNametags(framePath, CONFIG_1080P, teamColors);
  const elapsed = performance.now() - t0;

  console.log(`   ${nametags.length} nametag(s) detected in ${elapsed.toFixed(0)}ms`);
  for (const nt of nametags) {
    console.log(`   "${nt.text}" [${nt.team}] conf=${(nt.confidence * 100).toFixed(0)}% pos=(${nt.screenPosition.x}, ${nt.screenPosition.y})`);
  }
  console.log();
}

console.log('Done!');
