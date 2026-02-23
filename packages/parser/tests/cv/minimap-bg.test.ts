import { describe, it, expect } from 'vitest';
import { subtractBackground, type MinimapBackground } from '../../src/cv/minimap-bg.js';
import type { HSVColor } from '../../src/types.js';

/** Helper: create a uniform HSV array. */
function uniformHsv(h: number, s: number, v: number, count: number): HSVColor[] {
  return Array.from({ length: count }, () => ({ h, s, v }));
}

describe('subtractBackground', () => {
  const WIDTH = 10;
  const HEIGHT = 10;
  const PIXELS = WIDTH * HEIGHT;

  it('marks identical pixels as background (1)', () => {
    const bg: MinimapBackground = {
      hsv: uniformHsv(120, 60, 40, PIXELS),
      width: WIDTH,
      height: HEIGHT,
    };
    const frame = uniformHsv(120, 60, 40, PIXELS);

    const mask = subtractBackground(frame, bg);
    // All pixels identical → all background
    expect(mask.every(v => v === 1)).toBe(true);
  });

  it('marks very different pixels as foreground (0)', () => {
    const bg: MinimapBackground = {
      hsv: uniformHsv(120, 60, 40, PIXELS), // green field
      width: WIDTH,
      height: HEIGHT,
    };
    // Bright white marker
    const frame = uniformHsv(0, 5, 95, PIXELS);

    const mask = subtractBackground(frame, bg);
    // All pixels very different → all foreground
    expect(mask.every(v => v === 0)).toBe(true);
  });

  it('correctly separates a single marker from background', () => {
    // Background: green field
    const bgHsv = uniformHsv(120, 60, 40, PIXELS);
    const bg: MinimapBackground = { hsv: bgHsv, width: WIDTH, height: HEIGHT };

    // Frame: mostly same, but pixel 55 is a bright red marker
    const frame = uniformHsv(120, 60, 40, PIXELS);
    frame[55] = { h: 0, s: 90, v: 80 }; // red marker

    const mask = subtractBackground(frame, bg);

    // Pixel 55 should be foreground (0), rest background (1)
    expect(mask[55]).toBe(0);
    const bgCount = mask.reduce((s, v) => s + v, 0);
    expect(bgCount).toBe(PIXELS - 1);
  });

  it('detects gray team markers against green background', () => {
    // Green field background
    const bg: MinimapBackground = {
      hsv: uniformHsv(120, 60, 40, PIXELS),
      width: WIDTH,
      height: HEIGHT,
    };

    // Gray marker: low saturation, medium value
    const frame = uniformHsv(120, 60, 40, PIXELS);
    frame[22] = { h: 0, s: 3, v: 78 }; // gray marker

    const mask = subtractBackground(frame, bg);
    // Gray marker differs significantly in saturation and value from green field
    expect(mask[22]).toBe(0);
  });

  it('keeps white field lines as background when they match', () => {
    // Background includes a white field line at pixel 30
    const bgHsv = uniformHsv(120, 60, 40, PIXELS);
    bgHsv[30] = { h: 0, s: 5, v: 90 }; // white line in background
    const bg: MinimapBackground = { hsv: bgHsv, width: WIDTH, height: HEIGHT };

    // Frame also has the same white field line
    const frame = uniformHsv(120, 60, 40, PIXELS);
    frame[30] = { h: 0, s: 5, v: 90 }; // same white line

    const mask = subtractBackground(frame, bg);
    // Field line matches background → background (1)
    expect(mask[30]).toBe(1);
  });

  it('gray marker on white field line needs tight threshold', () => {
    // Background: white field line at pixel 30
    const bgHsv = uniformHsv(120, 60, 40, PIXELS);
    bgHsv[30] = { h: 0, s: 5, v: 90 }; // white field line
    const bg: MinimapBackground = { hsv: bgHsv, width: WIDTH, height: HEIGHT };

    // Frame: gray marker sitting on the field line position
    const frame = uniformHsv(120, 60, 40, PIXELS);
    frame[30] = { h: 0, s: 3, v: 78 }; // gray marker (diff ≈ 9.0 from white line)

    // Default threshold (15) misses it — diff is only 9
    const maskDefault = subtractBackground(frame, bg);
    expect(maskDefault[30]).toBe(1); // classified as background

    // Tight threshold (8) catches it
    const maskTight = subtractBackground(frame, bg, 8);
    expect(maskTight[30]).toBe(0); // foreground
  });

  it('respects custom threshold', () => {
    const bg: MinimapBackground = {
      hsv: uniformHsv(120, 60, 40, PIXELS),
      width: WIDTH,
      height: HEIGHT,
    };

    // Slightly different pixel: +10 value → diff ≈ 7.0
    const frame = uniformHsv(120, 60, 40, PIXELS);
    frame[0] = { h: 120, s: 60, v: 50 };

    // Tight threshold (5) → foreground
    const maskTight = subtractBackground(frame, bg, 5);
    expect(maskTight[0]).toBe(0);

    // Loose threshold (20) → background
    const maskLoose = subtractBackground(frame, bg, 20);
    expect(maskLoose[0]).toBe(1);
  });
});
