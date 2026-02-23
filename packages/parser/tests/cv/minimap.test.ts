import { describe, it, expect, beforeAll } from 'vitest';
import { parseMinimap, minimapToNormalized } from '../../src/cv/minimap.js';
import { CONFIG_1080P } from '../../src/config.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_FRAME = path.resolve(__dirname, '../../output/debug/sample_frame.png');

// Team colors extracted from scorebug (calibrated values)
// Our team wears GRAY (low saturation), opponent wears GREEN
const ourColor = { h: 0, s: 3, v: 78 };     // Gray (hue irrelevant for desaturated colors)
const oppColor = { h: 94, s: 97, v: 57 };   // Green

describe('parseMinimap', () => {
  beforeAll(() => {
    if (!fs.existsSync(SAMPLE_FRAME)) {
      console.warn(`
        Sample frame not found at: ${SAMPLE_FRAME}

        To generate it, extract a frame from the test video:
          ffmpeg -ss 5 -i .claude/later.mp4 -frames:v 1 output/debug/sample_frame.png
      `);
    }
  });

  it('detects player markers in sample frame', async () => {
    if (!fs.existsSync(SAMPLE_FRAME)) return;

    const result = await parseMinimap(SAMPLE_FRAME, {
      config: CONFIG_1080P,
      ourColor,
      oppColor,
    });

    // Should find at least one player marker
    expect(result.markers.length).toBeGreaterThanOrEqual(1);
  });

  it('detects the green opponent marker (diamond)', async () => {
    if (!fs.existsSync(SAMPLE_FRAME)) return;

    const result = await parseMinimap(SAMPLE_FRAME, {
      config: CONFIG_1080P,
      ourColor,
      oppColor,
    });

    // Find an opponent marker that is a diamond (not an arrow which is an off-screen indicator)
    const oppMarkers = result.markers.filter(m => m.team === 'opp_team');
    expect(oppMarkers.length).toBeGreaterThan(0);

    const oppDiamond = oppMarkers.find(m => m.shape === 'diamond');
    expect(oppDiamond).toBeDefined();

    if (oppDiamond) {
      // Color should be in the green range
      expect(oppDiamond.color.h).toBeGreaterThan(85);
      expect(oppDiamond.color.h).toBeLessThan(110);
      expect(oppDiamond.color.s).toBeGreaterThan(70);
    }
  });

  it('detects the ball marker', async () => {
    if (!fs.existsSync(SAMPLE_FRAME)) return;

    const result = await parseMinimap(SAMPLE_FRAME, {
      config: CONFIG_1080P,
      ourColor,
      oppColor,
    });

    // Ball should be detected
    expect(result.ballMarker).not.toBeNull();

    if (result.ballMarker) {
      // Ball position should be within minimap bounds
      expect(result.ballMarker.position.x).toBeGreaterThanOrEqual(0);
      expect(result.ballMarker.position.x).toBeLessThanOrEqual(1);
      expect(result.ballMarker.position.y).toBeGreaterThanOrEqual(0);
      expect(result.ballMarker.position.y).toBeLessThanOrEqual(1);
    }
  });

  it('returns correct minimap metadata', async () => {
    if (!fs.existsSync(SAMPLE_FRAME)) return;

    const result = await parseMinimap(SAMPLE_FRAME, {
      config: CONFIG_1080P,
      ourColor,
      oppColor,
    });

    // Check minimap center matches config
    expect(result.minimapCenter.x).toBe(CONFIG_1080P.minimap.centerX);
    expect(result.minimapCenter.y).toBe(CONFIG_1080P.minimap.centerY);
    expect(result.minimapRadius).toBe(CONFIG_1080P.minimap.radius);
  });

  it('marker positions are normalized to 0-1 range', async () => {
    if (!fs.existsSync(SAMPLE_FRAME)) return;

    const result = await parseMinimap(SAMPLE_FRAME, {
      config: CONFIG_1080P,
      ourColor,
      oppColor,
    });

    for (const marker of result.markers) {
      expect(marker.position.x).toBeGreaterThanOrEqual(0);
      expect(marker.position.x).toBeLessThanOrEqual(1);
      expect(marker.position.y).toBeGreaterThanOrEqual(0);
      expect(marker.position.y).toBeLessThanOrEqual(1);
    }
  });
});

describe('minimapToNormalized', () => {
  it('converts center pixel to (0.5, 0.5)', () => {
    const radius = 100;
    const result = minimapToNormalized({ x: 100, y: 100 }, radius);

    expect(result.x).toBeCloseTo(0.5, 5);
    expect(result.y).toBeCloseTo(0.5, 5);
  });

  it('converts top-left pixel to (0, 0)', () => {
    const radius = 100;
    const result = minimapToNormalized({ x: 0, y: 0 }, radius);

    expect(result.x).toBeCloseTo(0, 5);
    expect(result.y).toBeCloseTo(0, 5);
  });

  it('converts bottom-right pixel to (1, 1)', () => {
    const radius = 100;
    const result = minimapToNormalized({ x: 200, y: 200 }, radius);

    expect(result.x).toBeCloseTo(1, 5);
    expect(result.y).toBeCloseTo(1, 5);
  });
});

describe('Minimap config validation', () => {
  it('minimap is in bottom-right quadrant for 1080p', () => {
    const { centerX, centerY, radius } = CONFIG_1080P.minimap;

    // Should be in the right half
    expect(centerX).toBeGreaterThan(960);

    // Should be in the bottom half
    expect(centerY).toBeGreaterThan(540);

    // Radius should be reasonable (includes space for edge arrows)
    expect(radius).toBeGreaterThan(50);
    expect(radius).toBeLessThan(300);

    // Should fit within frame bounds
    expect(centerX - radius).toBeGreaterThanOrEqual(0);
    expect(centerX + radius).toBeLessThanOrEqual(1920);
    expect(centerY - radius).toBeGreaterThanOrEqual(0);
    expect(centerY + radius).toBeLessThanOrEqual(1080);
  });
});
