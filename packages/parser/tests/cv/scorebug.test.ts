import { describe, it, expect, beforeAll } from 'vitest';
import { extractScorebugColors } from '../../src/cv/scorebug.js';
import { CONFIG_1080P } from '../../src/config.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_FRAME = path.resolve(__dirname, '../../output/debug/sample_frame.png');

describe('extractScorebugColors', () => {
  beforeAll(() => {
    // Check if sample frame exists
    if (!fs.existsSync(SAMPLE_FRAME)) {
      console.warn(`
        Sample frame not found at: ${SAMPLE_FRAME}

        To generate it, run:
          npm run build
          node dist/index.js --test-scorebug .claude/later.mp4

        Or extract a frame manually using ffmpeg:
          ffmpeg -ss 5 -i .claude/later.mp4 -frames:v 1 output/debug/sample_frame.png
      `);
    }
  });

  it('extracts time string from sample frame', async () => {
    if (!fs.existsSync(SAMPLE_FRAME)) {
      return; // Skip if no sample frame
    }

    const result = await extractScorebugColors(SAMPLE_FRAME, CONFIG_1080P);

    // Time should be a string in MM:SS format or default
    expect(typeof result.timeRemaining).toBe('string');
    expect(result.timeRemaining).toMatch(/^\d{1,2}:\d{2}$/);
    expect(typeof result.timeRemainingSeconds).toBe('number');
    expect(result.timeRemainingSeconds).toBeGreaterThanOrEqual(0);
  });

  it('extracts score values from sample frame', async () => {
    if (!fs.existsSync(SAMPLE_FRAME)) {
      return;
    }

    const result = await extractScorebugColors(SAMPLE_FRAME, CONFIG_1080P);

    // Scores should be non-negative integers
    expect(typeof result.scoreOurs).toBe('number');
    expect(typeof result.scoreOpponent).toBe('number');
    expect(result.scoreOurs).toBeGreaterThanOrEqual(0);
    expect(result.scoreOpponent).toBeGreaterThanOrEqual(0);
  });

  it('extracts our team color (gray) from sample frame', async () => {
    if (!fs.existsSync(SAMPLE_FRAME)) {
      return;
    }

    const result = await extractScorebugColors(SAMPLE_FRAME, CONFIG_1080P);

    // Gray color: low saturation (hue is irrelevant for grays)
    expect(result.ourTeamColor.s).toBeLessThan(20);

    // Gray has medium-high value (light gray)
    expect(result.ourTeamColor.v).toBeGreaterThan(70);
  });

  it('extracts opponent team color (green) from sample frame', async () => {
    if (!fs.existsSync(SAMPLE_FRAME)) {
      return;
    }

    const result = await extractScorebugColors(SAMPLE_FRAME, CONFIG_1080P);

    // Green hue should be around 90-100
    expect(result.oppTeamColor.h).toBeGreaterThan(85);
    expect(result.oppTeamColor.h).toBeLessThan(105);

    // Should be highly saturated
    expect(result.oppTeamColor.s).toBeGreaterThan(90);

    // Bright green has medium-high value
    expect(result.oppTeamColor.v).toBeGreaterThan(50);
  });

  it('team colors are distinguishable', async () => {
    if (!fs.existsSync(SAMPLE_FRAME)) {
      return;
    }

    const result = await extractScorebugColors(SAMPLE_FRAME, CONFIG_1080P);

    // Colors should be distinguishable by saturation: gray (<20) vs green (>80)
    const satDiff = Math.abs(result.ourTeamColor.s - result.oppTeamColor.s);
    expect(satDiff).toBeGreaterThan(60);
  });
});

describe('Scorebug config validation', () => {
  it('has valid swatch coordinates', () => {
    const { scorebug } = CONFIG_1080P;

    // Swatches should be within the scorebug region
    expect(scorebug.ourSwatchX).toBeGreaterThanOrEqual(scorebug.x);
    expect(scorebug.ourSwatchX + scorebug.ourSwatchWidth).toBeLessThanOrEqual(
      scorebug.x + scorebug.width
    );

    expect(scorebug.oppSwatchX).toBeGreaterThanOrEqual(scorebug.x);
    expect(scorebug.oppSwatchX + scorebug.oppSwatchWidth).toBeLessThanOrEqual(
      scorebug.x + scorebug.width
    );

    // SwatchY should be within scorebug height
    expect(scorebug.swatchY).toBeGreaterThanOrEqual(scorebug.y);
    expect(scorebug.swatchY + scorebug.swatchHeight).toBeLessThanOrEqual(
      scorebug.y + scorebug.height
    );
  });

  it('has reasonable dimensions for 1080p', () => {
    const { scorebug, minimap } = CONFIG_1080P;

    // Scorebug should be in top-left
    expect(scorebug.x).toBeLessThan(100);
    expect(scorebug.y).toBeLessThan(100);

    // Minimap should be in bottom-right for Rematch
    expect(minimap.centerX).toBeGreaterThan(1600);
    expect(minimap.centerY).toBeGreaterThan(800);
  });
});
