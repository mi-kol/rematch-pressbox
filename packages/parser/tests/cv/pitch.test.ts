import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TOPOLOGY,
  resolveGeometry,
  generateFieldLineMask,
  classifyPitchZone,
  pointToSegmentDistance,
  type PitchRect,
} from '../../src/cv/pitch.js';

// A representative pitch rect inscribed in a circle (normalized 0-1).
// Standard 105x68 pitch: aspect ratio ~1.544
// Diagonal = sqrt(105^2 + 68^2) = 125.1
// Width occupies 68/125.1 = 0.544 of diameter, height 105/125.1 = 0.840
const TEST_RECT: PitchRect = {
  left:   0.5 - 0.272,   // 0.228
  top:    0.5 - 0.420,   // 0.080
  right:  0.5 + 0.272,   // 0.772
  bottom: 0.5 + 0.420,   // 0.920
};

const TEST_GEOMETRY = resolveGeometry(TEST_RECT, DEFAULT_TOPOLOGY);

describe('pointToSegmentDistance', () => {
  it('returns 0 for a point on the segment', () => {
    expect(pointToSegmentDistance(0.5, 0.5, 0, 0.5, 1, 0.5)).toBeCloseTo(0, 5);
  });

  it('returns perpendicular distance for a point off the segment', () => {
    // Point (0.5, 0.6) to horizontal segment y=0.5 from x=0 to x=1
    expect(pointToSegmentDistance(0.5, 0.6, 0, 0.5, 1, 0.5)).toBeCloseTo(0.1, 5);
  });

  it('returns distance to endpoint for a point beyond the segment', () => {
    // Point (2, 0) to segment (0,0)-(1,0) → distance to endpoint (1,0) = 1
    expect(pointToSegmentDistance(2, 0, 0, 0, 1, 0)).toBeCloseTo(1, 5);
  });

  it('handles degenerate segment (zero length)', () => {
    expect(pointToSegmentDistance(1, 0, 0, 0, 0, 0)).toBeCloseTo(1, 5);
  });
});

describe('resolveGeometry', () => {
  it('generates line segments for pitch boundaries', () => {
    // Should have at least 4 boundary lines + halfway line
    expect(TEST_GEOMETRY.lines.length).toBeGreaterThanOrEqual(5);
  });

  it('generates center circle', () => {
    const centerCircle = TEST_GEOMETRY.circles.find(c =>
      Math.abs(c.cx - 0.5) < 0.01 && Math.abs(c.cy - 0.5) < 0.01
      && c.startAngle == null
    );
    expect(centerCircle).toBeDefined();
    expect(centerCircle!.r).toBeGreaterThan(0);
  });

  it('generates penalty arcs', () => {
    // Should have center circle + 2 penalty arcs = 3 circles
    expect(TEST_GEOMETRY.circles.length).toBe(3);
  });

  it('generates center spot and penalty spots', () => {
    // 1 center spot + 2 penalty spots = 3
    expect(TEST_GEOMETRY.spots.length).toBe(3);
  });

  it('penalty areas are inside the pitch rect', () => {
    const paDepth = DEFAULT_TOPOLOGY.penaltyAreaDepth * (TEST_RECT.bottom - TEST_RECT.top);
    // Own penalty area bottom edge
    const ownPaBottom = TEST_RECT.top + paDepth;
    expect(ownPaBottom).toBeLessThan(0.5); // Should be in own half

    // Opp penalty area top edge
    const oppPaTop = TEST_RECT.bottom - paDepth;
    expect(oppPaTop).toBeGreaterThan(0.5); // Should be in opp half
  });

  it('halfway line is at vertical center of pitch rect', () => {
    const pCY = (TEST_RECT.top + TEST_RECT.bottom) / 2;
    const halfwayLine = TEST_GEOMETRY.lines.find(l =>
      Math.abs(l.y1 - pCY) < 0.001 && Math.abs(l.y2 - pCY) < 0.001
    );
    expect(halfwayLine).toBeDefined();
    if (halfwayLine) {
      expect(halfwayLine.x1).toBeCloseTo(TEST_RECT.left, 2);
      expect(halfwayLine.x2).toBeCloseTo(TEST_RECT.right, 2);
    }
  });
});

describe('generateFieldLineMask', () => {
  const SIZE = 100; // Small size for fast tests
  const mask = generateFieldLineMask(TEST_GEOMETRY, SIZE, SIZE);

  it('returns a Uint8Array of correct size', () => {
    expect(mask).toBeInstanceOf(Uint8Array);
    expect(mask.length).toBe(SIZE * SIZE);
  });

  it('masks pixels on the halfway line', () => {
    // Halfway line is at y = 0.5 in normalized coords
    const py = Math.round(0.5 * SIZE);
    const px = Math.round(0.5 * SIZE); // Center of the line
    const idx = py * SIZE + px;
    expect(mask[idx]).toBe(1);
  });

  it('does not mask the center of the pitch (away from lines)', () => {
    // Slightly off-center to avoid the center spot
    const px = Math.round(0.5 * SIZE);
    const py = Math.round(0.4 * SIZE); // Between halfway line and top
    const idx = py * SIZE + px;
    // This should be clear of any lines
    expect(mask[idx]).toBe(0);
  });

  it('does not mask pixels outside the circular minimap', () => {
    // Corner pixel (0, 0) is outside the circle
    expect(mask[0]).toBe(0);
    // Bottom-right corner
    expect(mask[SIZE * SIZE - 1]).toBe(0);
  });

  it('has a reasonable percentage of masked pixels', () => {
    const maskedCount = mask.reduce((sum, v) => sum + v, 0);
    const percentage = maskedCount / mask.length;
    // Field lines should cover a small fraction (roughly 1-5%)
    expect(percentage).toBeGreaterThan(0.005);
    expect(percentage).toBeLessThan(0.15);
  });
});

describe('classifyPitchZone', () => {
  it('classifies center of pitch as center_circle', () => {
    expect(classifyPitchZone({ x: 0.5, y: 0.5 }, TEST_GEOMETRY)).toBe('center_circle');
  });

  it('classifies own half', () => {
    // In own half, away from penalty area and center circle
    const zone = classifyPitchZone({ x: 0.35, y: 0.25 }, TEST_GEOMETRY);
    expect(zone).toBe('own_half');
  });

  it('classifies opponent half', () => {
    const zone = classifyPitchZone({ x: 0.35, y: 0.75 }, TEST_GEOMETRY);
    expect(zone).toBe('opp_half');
  });

  it('classifies own penalty area', () => {
    // In penalty area but outside goal area (deeper from goal line)
    const zone = classifyPitchZone({ x: 0.5, y: TEST_RECT.top + 0.08 }, TEST_GEOMETRY);
    expect(zone).toBe('own_penalty_area');
  });

  it('classifies own goal area', () => {
    // Very close to our goal line, centered
    const zone = classifyPitchZone({ x: 0.5, y: TEST_RECT.top + 0.02 }, TEST_GEOMETRY);
    expect(zone).toBe('own_goal_area');
  });

  it('classifies opponent goal area', () => {
    const zone = classifyPitchZone({ x: 0.5, y: TEST_RECT.bottom - 0.01 }, TEST_GEOMETRY);
    expect(zone).toBe('opp_goal_area');
  });

  it('classifies off_pitch for positions outside the rect', () => {
    expect(classifyPitchZone({ x: 0.1, y: 0.5 }, TEST_GEOMETRY)).toBe('off_pitch');
    expect(classifyPitchZone({ x: 0.5, y: 0.01 }, TEST_GEOMETRY)).toBe('off_pitch');
  });
});
