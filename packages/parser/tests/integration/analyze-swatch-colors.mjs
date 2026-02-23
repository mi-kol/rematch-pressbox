/**
 * Analyze team colors from scorebug swatches with correct coordinates
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import chalk from 'chalk';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const framesDir = path.join(__dirname, '../../.claude', 'frames-for-claude');
const outputDir = path.join(__dirname, '../../output', 'debug');

// User-provided coordinates
const SWATCH_CONFIG = {
  ourSwatch: { x: 170, width: 24, y: 50, height: 10 },
  oppSwatch: { x: 326, width: 24, y: 50, height: 10 },
};

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex(r, g, b) {
  const rr = clampByte(r).toString(16).padStart(2, '0');
  const gg = clampByte(g).toString(16).padStart(2, '0');
  const bb = clampByte(b).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`.toUpperCase();
}

function chip(label, rgb, width = 14) {
  const r = clampByte(rgb.r ?? rgb[0]);
  const g = clampByte(rgb.g ?? rgb[1]);
  const b = clampByte(rgb.b ?? rgb[2]);

  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const fg = luminance > 0.6 ? [0, 0, 0] : [255, 255, 255];

  const block = ' '.repeat(width);
  const sw = chalk.bgRgb(r, g, b).rgb(...fg)(block);
  const hex = rgbToHex(r, g, b);

  return `${label.padEnd(10)} ${sw}  rgb(${r},${g},${b})  ${hex}`;
}

// optional: quick “human label”
function nameColor({ r, g, b, s, v }) {
  // very rough, but helpful for debugging
  const rr = clampByte(r), gg = clampByte(g), bb = clampByte(b);
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);

  if (v < 15) return 'near black';
  if (v > 90 && s < 10) return 'near white';
  if (s < 10 && max - min < 20) return 'gray-ish';

  if (gg > rr + 40 && gg > bb + 40) return 'green-ish';
  if (rr > gg + 40 && rr > bb + 40) return 'red-ish';
  if (bb > rr + 40 && bb > gg + 40) return 'blue-ish';

  return 'mixed';
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return { h: h * 360, s: s * 100, v: v * 100 };
}

async function analyzeSwatchColors(framePath, config) {
  const image = sharp(framePath);

  // Extract our team swatch
  const ourBuffer = await image.clone()
    .extract({
      left: config.ourSwatch.x,
      top: config.ourSwatch.y,
      width: config.ourSwatch.width,
      height: config.ourSwatch.height,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Extract opponent swatch
  const oppBuffer = await sharp(framePath)
    .extract({
      left: config.oppSwatch.x,
      top: config.oppSwatch.y,
      width: config.oppSwatch.width,
      height: config.oppSwatch.height,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Analyze colors
  function analyzePixels(data, channels) {
    const colors = [];
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const hsv = rgbToHsv(r, g, b);
      colors.push({ r, g, b, ...hsv });
    }

    // Calculate average
    const avg = {
      r: colors.reduce((s, c) => s + c.r, 0) / colors.length,
      g: colors.reduce((s, c) => s + c.g, 0) / colors.length,
      b: colors.reduce((s, c) => s + c.b, 0) / colors.length,
      h: colors.reduce((s, c) => s + c.h, 0) / colors.length,
      s: colors.reduce((s, c) => s + c.s, 0) / colors.length,
      v: colors.reduce((s, c) => s + c.v, 0) / colors.length,
    };

    // Find dominant color (highest saturation pixels)
    const saturated = colors.filter(c => c.s > 20).sort((a, b) => b.s - a.s);
    const dominant = saturated.length > 0 ? saturated[0] : avg;

    return { avg, dominant, samples: colors.slice(0, 10) };
  }

  const ourColors = analyzePixels(ourBuffer.data, ourBuffer.info.channels);
  const oppColors = analyzePixels(oppBuffer.data, oppBuffer.info.channels);

  return { ourColors, oppColors };
}

// Also save swatch images for visual verification
async function saveSwatchImages(framePath, frameName) {
  await sharp(framePath)
    .extract({
      left: SWATCH_CONFIG.ourSwatch.x,
      top: SWATCH_CONFIG.ourSwatch.y,
      width: SWATCH_CONFIG.ourSwatch.width,
      height: SWATCH_CONFIG.ourSwatch.height,
    })
    .resize(SWATCH_CONFIG.ourSwatch.width * 10, SWATCH_CONFIG.ourSwatch.height * 10, { kernel: 'nearest' })
    .toFile(path.join(outputDir, `swatch_our_${frameName}.png`));

  await sharp(framePath)
    .extract({
      left: SWATCH_CONFIG.oppSwatch.x,
      top: SWATCH_CONFIG.oppSwatch.y,
      width: SWATCH_CONFIG.oppSwatch.width,
      height: SWATCH_CONFIG.oppSwatch.height,
    })
    .resize(SWATCH_CONFIG.oppSwatch.width * 10, SWATCH_CONFIG.oppSwatch.height * 10, { kernel: 'nearest' })
    .toFile(path.join(outputDir, `swatch_opp_${frameName}.png`));
}

// Main
const frames = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg'));

console.log('Swatch coordinates:');
console.log(`  Our team:  x(${SWATCH_CONFIG.ourSwatch.x}-${SWATCH_CONFIG.ourSwatch.x + SWATCH_CONFIG.ourSwatch.width}), y(${SWATCH_CONFIG.ourSwatch.y}-${SWATCH_CONFIG.ourSwatch.y + SWATCH_CONFIG.ourSwatch.height})`);
console.log(`  Opponent:  x(${SWATCH_CONFIG.oppSwatch.x}-${SWATCH_CONFIG.oppSwatch.x + SWATCH_CONFIG.oppSwatch.width}), y(${SWATCH_CONFIG.oppSwatch.y}-${SWATCH_CONFIG.oppSwatch.y + SWATCH_CONFIG.oppSwatch.height})`);

for (const frame of frames) {
  const framePath = path.join(framesDir, frame);
  const frameName = path.basename(frame, '.jpg');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Frame: ${frame}`);
  console.log('='.repeat(60));

  try {
    const { ourColors, oppColors } = await analyzeSwatchColors(framePath, SWATCH_CONFIG);

    console.log('\nOur Team Swatch:');
    console.log(chip('avg', ourColors.avg));
    console.log(chip('dominant', ourColors.dominant));
    console.log(`  color: ${nameColor(ourColors.dominant)}`);

    console.log('\nOpponent Swatch:');
    console.log(chip('avg', oppColors.avg));
    console.log(chip('dominant', oppColors.dominant));
    console.log(`  color: ${nameColor(oppColors.dominant)}`);

    // Save swatch images for first frame
    if (frame === frames[0]) {
      await saveSwatchImages(framePath, frameName);
      console.log(`\nSaved swatch images to output/debug/swatch_our_${frameName}.png and swatch_opp_${frameName}.png`);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
}
