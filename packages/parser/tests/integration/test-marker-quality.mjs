/**
 * Analyze marker quality: size distribution, confidence, position spread.
 * Helps understand why we get 20-57 markers instead of ~11.
 */
import fs from 'fs';
import path from 'path';
import { CONFIG_1080P } from '../../dist/config.js';
import { extractScorebugColors } from '../../dist/cv/scorebug.js';
import { buildMinimapBackground, extractMinimapHsv, subtractBackground } from '../../dist/cv/minimap-bg.js';
import { parseMinimap } from '../../dist/cv/minimap.js';

const framesDir = '../../output/test-fusion/frames';
const bgDir = '../../output/test-fusion/bg';
const config = CONFIG_1080P;

const frameFiles = fs.readdirSync(framesDir).filter(f => f.endsWith('.png')).sort();
const bgPaths = fs.readdirSync(bgDir).filter(f => f.endsWith('.png')).sort().map(f => path.join(bgDir, f));

const background = await buildMinimapBackground(bgPaths, config);
const firstFrame = path.join(framesDir, frameFiles[0]);
const scorebug = await extractScorebugColors(firstFrame, config);
const teamColors = { ours: scorebug.ourTeamColor, opponent: scorebug.oppTeamColor };

// Analyze 5 frames
const sizes = { our: [], opp: [], ball: [], white: [] };
for (let i = 0; i < 5; i++) {
  const framePath = path.join(framesDir, frameFiles[i * 5]); // every 5th
  const frameHsv = await extractMinimapHsv(framePath, config);
  const bgMask = subtractBackground(frameHsv.hsv, background);

  const detection = await parseMinimap(framePath, {
    config, ourColor: teamColors.ours, oppColor: teamColors.opponent, backgroundMask: bgMask,
  });

  const allMarkers = [...detection.markers];
  if (detection.ballMarker) allMarkers.push(detection.ballMarker);

  console.log(`\n--- Frame ${i * 5 + 1}: ${allMarkers.length} total markers ---`);

  // Group by team
  const byTeam = { our_team: [], opp_team: [], null: [] };
  for (const m of allMarkers) {
    const key = m.team || 'null';
    byTeam[key] = byTeam[key] || [];
    byTeam[key].push(m);
  }

  for (const [team, markers] of Object.entries(byTeam)) {
    if (markers.length === 0) continue;
    const sizeArr = markers.map(m => m.radiusPixels);
    const confArr = markers.map(m => m.confidence);
    console.log(`  ${team} (${markers.length}):`);
    for (const m of markers) {
      const area = Math.round(Math.PI * m.radiusPixels * m.radiusPixels);
      console.log(
        `    ${m.shape.padEnd(8)} pos=(${m.position.x.toFixed(2)},${m.position.y.toFixed(2)}) ` +
        `r=${m.radiusPixels.toFixed(1)} area≈${area} conf=${m.confidence.toFixed(2)} ` +
        `color=H${m.color.h.toFixed(0)}S${m.color.s.toFixed(0)}V${m.color.v.toFixed(0)}`
      );
    }
  }
}
