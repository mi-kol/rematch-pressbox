import { describe, it, expect } from 'vitest';
import { rgbToHsv, hsvToRgb, colorDistanceHsv, colorsMatch, findDominantColor } from '../../src/cv/colors.js';
import type { RGBColor, HSVColor } from '../../src/types.js';

describe('rgbToHsv', () => {
  it('converts pure red', () => {
    const rgb: RGBColor = { r: 255, g: 0, b: 0 };
    const hsv = rgbToHsv(rgb);
    expect(hsv.h).toBeCloseTo(0, 0);
    expect(hsv.s).toBeCloseTo(100, 0);
    expect(hsv.v).toBeCloseTo(100, 0);
  });

  it('converts pure green', () => {
    const rgb: RGBColor = { r: 0, g: 255, b: 0 };
    const hsv = rgbToHsv(rgb);
    expect(hsv.h).toBeCloseTo(120, 0);
    expect(hsv.s).toBeCloseTo(100, 0);
    expect(hsv.v).toBeCloseTo(100, 0);
  });

  it('converts pure blue', () => {
    const rgb: RGBColor = { r: 0, g: 0, b: 255 };
    const hsv = rgbToHsv(rgb);
    expect(hsv.h).toBeCloseTo(240, 0);
    expect(hsv.s).toBeCloseTo(100, 0);
    expect(hsv.v).toBeCloseTo(100, 0);
  });

  it('converts white', () => {
    const rgb: RGBColor = { r: 255, g: 255, b: 255 };
    const hsv = rgbToHsv(rgb);
    expect(hsv.s).toBeCloseTo(0, 0);
    expect(hsv.v).toBeCloseTo(100, 0);
  });

  it('converts black', () => {
    const rgb: RGBColor = { r: 0, g: 0, b: 0 };
    const hsv = rgbToHsv(rgb);
    expect(hsv.s).toBeCloseTo(0, 0);
    expect(hsv.v).toBeCloseTo(0, 0);
  });

  it('converts dark blue (Rematch team color)', () => {
    // RGB(4, 49, 80) - the dark blue from the test footage
    const rgb: RGBColor = { r: 4, g: 49, b: 80 };
    const hsv = rgbToHsv(rgb);
    expect(hsv.h).toBeGreaterThan(200);
    expect(hsv.h).toBeLessThan(220);
    expect(hsv.s).toBeGreaterThan(90);
    expect(hsv.v).toBeGreaterThan(25);
    expect(hsv.v).toBeLessThan(35);
  });

  it('converts bright green (Rematch team color)', () => {
    // RGB(67, 152, 4) - the green from the test footage
    const rgb: RGBColor = { r: 67, g: 152, b: 4 };
    const hsv = rgbToHsv(rgb);
    expect(hsv.h).toBeGreaterThan(85);
    expect(hsv.h).toBeLessThan(100);
    expect(hsv.s).toBeGreaterThan(95);
    expect(hsv.v).toBeGreaterThan(55);
    expect(hsv.v).toBeLessThan(65);
  });
});

describe('hsvToRgb', () => {
  it('converts pure red', () => {
    const hsv: HSVColor = { h: 0, s: 100, v: 100 };
    const rgb = hsvToRgb(hsv);
    expect(rgb.r).toBe(255);
    expect(rgb.g).toBe(0);
    expect(rgb.b).toBe(0);
  });

  it('converts pure green', () => {
    const hsv: HSVColor = { h: 120, s: 100, v: 100 };
    const rgb = hsvToRgb(hsv);
    expect(rgb.r).toBe(0);
    expect(rgb.g).toBe(255);
    expect(rgb.b).toBe(0);
  });

  it('converts pure blue', () => {
    const hsv: HSVColor = { h: 240, s: 100, v: 100 };
    const rgb = hsvToRgb(hsv);
    expect(rgb.r).toBe(0);
    expect(rgb.g).toBe(0);
    expect(rgb.b).toBe(255);
  });

  it('roundtrips correctly', () => {
    const original: RGBColor = { r: 128, g: 64, b: 192 };
    const hsv = rgbToHsv(original);
    const roundtrip = hsvToRgb(hsv);
    expect(roundtrip.r).toBeCloseTo(original.r, 0);
    expect(roundtrip.g).toBeCloseTo(original.g, 0);
    expect(roundtrip.b).toBeCloseTo(original.b, 0);
  });
});

describe('colorDistanceHsv', () => {
  it('returns 0 for identical colors', () => {
    const color: HSVColor = { h: 120, s: 80, v: 60 };
    expect(colorDistanceHsv(color, color)).toBe(0);
  });

  it('returns small distance for similar colors', () => {
    const a: HSVColor = { h: 120, s: 80, v: 60 };
    const b: HSVColor = { h: 125, s: 75, v: 65 };
    const distance = colorDistanceHsv(a, b);
    expect(distance).toBeLessThan(0.15);
  });

  it('returns large distance for different colors', () => {
    const red: HSVColor = { h: 0, s: 100, v: 100 };
    const green: HSVColor = { h: 120, s: 100, v: 100 };
    const distance = colorDistanceHsv(red, green);
    expect(distance).toBeGreaterThan(0.3);
  });

  it('handles hue wraparound (red to magenta)', () => {
    const red: HSVColor = { h: 5, s: 100, v: 100 };
    const magenta: HSVColor = { h: 355, s: 100, v: 100 };
    const distance = colorDistanceHsv(red, magenta);
    // Should be small because 355 and 5 are close on the hue wheel
    expect(distance).toBeLessThan(0.1);
  });
});

describe('colorsMatch', () => {
  it('returns true for identical colors', () => {
    const color: HSVColor = { h: 200, s: 85, v: 30 };
    expect(colorsMatch(color, color)).toBe(true);
  });

  it('returns true for colors within tolerance', () => {
    const a: HSVColor = { h: 200, s: 85, v: 30 };
    const b: HSVColor = { h: 210, s: 80, v: 35 };
    expect(colorsMatch(a, b, 15, 30, 30)).toBe(true);
  });

  it('returns false for colors outside tolerance', () => {
    const blue: HSVColor = { h: 200, s: 85, v: 30 };
    const green: HSVColor = { h: 95, s: 97, v: 57 };
    expect(colorsMatch(blue, green)).toBe(false);
  });
});

describe('findDominantColor', () => {
  it('finds solid color from uniform buffer', () => {
    // Create a 10x10 buffer of solid green (RGB 0, 200, 0)
    const width = 10;
    const height = 10;
    const channels = 3;
    const pixels = Buffer.alloc(width * height * channels);

    for (let i = 0; i < width * height; i++) {
      pixels[i * 3] = 0;     // R
      pixels[i * 3 + 1] = 200; // G
      pixels[i * 3 + 2] = 0;   // B
    }

    const dominant = findDominantColor(pixels, width, height, channels);
    expect(dominant.h).toBeGreaterThan(115);
    expect(dominant.h).toBeLessThan(125);
    expect(dominant.s).toBeGreaterThan(90);
  });

  it('prefers saturated colors over desaturated ones', () => {
    // Create a buffer with mostly gray but some saturated blue
    const width = 10;
    const height = 10;
    const channels = 3;
    const pixels = Buffer.alloc(width * height * channels);

    // Fill mostly with gray (desaturated)
    for (let i = 0; i < width * height; i++) {
      pixels[i * 3] = 180;
      pixels[i * 3 + 1] = 180;
      pixels[i * 3 + 2] = 180;
    }

    // Add some saturated blue pixels in the corner
    for (let i = 0; i < 20; i++) {
      pixels[i * 3] = 0;
      pixels[i * 3 + 1] = 50;
      pixels[i * 3 + 2] = 150;
    }

    const dominant = findDominantColor(pixels, width, height, channels);
    // Should find the blue, not the gray (gray is filtered out due to low saturation)
    expect(dominant.h).toBeGreaterThan(200);
    expect(dominant.h).toBeLessThan(230);
  });

  it('returns zero for all-black buffer', () => {
    const width = 5;
    const height = 5;
    const pixels = Buffer.alloc(width * height * 3, 0);

    const dominant = findDominantColor(pixels, width, height, 3);
    expect(dominant.h).toBe(0);
    expect(dominant.s).toBe(0);
    expect(dominant.v).toBe(0);
  });
});
