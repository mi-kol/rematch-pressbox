import { describe, it, expect } from 'vitest';
import { solveAssignment, buildCostMatrix } from '../../src/tracking/hungarian.js';
import type { Vector2 } from '../../src/types.js';

describe('buildCostMatrix', () => {
  it('returns empty matrix for empty inputs', () => {
    const result = buildCostMatrix(new Map(), []);
    expect(result.matrix).toEqual([]);
    expect(result.trackIds).toEqual([]);
  });

  it('builds correct distance matrix', () => {
    const tracks = new Map<string, Vector2>([
      ['A', { x: 0, y: 0 }],
      ['B', { x: 1, y: 0 }],
    ]);
    const markers: Vector2[] = [
      { x: 0.1, y: 0 },
      { x: 0.9, y: 0 },
    ];

    const { matrix, trackIds } = buildCostMatrix(tracks, markers, 0.5);
    expect(trackIds).toEqual(['A', 'B']);
    // A→marker0 = 0.1, A→marker1 = 0.9 (>0.5 → 1000000)
    expect(matrix[0][0]).toBeCloseTo(0.1, 5);
    expect(matrix[0][1]).toBe(1000000);
    // B→marker0 = 0.9 (>0.5 → 1000000), B→marker1 = 0.1
    expect(matrix[1][0]).toBe(1000000);
    expect(matrix[1][1]).toBeCloseTo(0.1, 5);
  });

  it('marks distances beyond maxDistance as impossible', () => {
    const tracks = new Map<string, Vector2>([['A', { x: 0, y: 0 }]]);
    const markers: Vector2[] = [{ x: 0.5, y: 0.5 }];

    const { matrix } = buildCostMatrix(tracks, markers, 0.1);
    // Distance = ~0.707, well beyond 0.1
    expect(matrix[0][0]).toBe(1000000);
  });
});

describe('solveAssignment', () => {
  it('returns all markers as unassigned when no tracks exist', () => {
    const markers: Vector2[] = [{ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.3 }];
    const result = solveAssignment(new Map(), markers);

    expect(result.assignments).toEqual([]);
    expect(result.unassignedTracks).toEqual([]);
    expect(result.unassignedMarkers).toEqual([0, 1]);
  });

  it('returns all tracks as unassigned when no markers exist', () => {
    const tracks = new Map<string, Vector2>([
      ['A', { x: 0.5, y: 0.5 }],
    ]);
    const result = solveAssignment(tracks, []);

    expect(result.assignments).toEqual([]);
    expect(result.unassignedTracks).toEqual(['A']);
    expect(result.unassignedMarkers).toEqual([]);
  });

  it('assigns nearby track-marker pairs optimally', () => {
    const tracks = new Map<string, Vector2>([
      ['A', { x: 0.1, y: 0.1 }],
      ['B', { x: 0.9, y: 0.9 }],
    ]);
    const markers: Vector2[] = [
      { x: 0.88, y: 0.92 }, // Close to B
      { x: 0.12, y: 0.08 }, // Close to A
    ];

    const result = solveAssignment(tracks, markers, 0.2);
    expect(result.assignments).toHaveLength(2);
    expect(result.unassignedTracks).toEqual([]);
    expect(result.unassignedMarkers).toEqual([]);

    // A should match marker 1, B should match marker 0
    const aAssignment = result.assignments.find(a => a.trackId === 'A');
    const bAssignment = result.assignments.find(a => a.trackId === 'B');
    expect(aAssignment?.markerIndex).toBe(1);
    expect(bAssignment?.markerIndex).toBe(0);
  });

  it('leaves tracks unassigned when markers are too far', () => {
    const tracks = new Map<string, Vector2>([
      ['A', { x: 0, y: 0 }],
    ]);
    const markers: Vector2[] = [{ x: 0.9, y: 0.9 }];

    const result = solveAssignment(tracks, markers, 0.1);
    expect(result.assignments).toEqual([]);
    expect(result.unassignedTracks).toEqual(['A']);
    expect(result.unassignedMarkers).toEqual([0]);
  });

  it('handles more markers than tracks (new players appear)', () => {
    const tracks = new Map<string, Vector2>([
      ['A', { x: 0.5, y: 0.5 }],
    ]);
    const markers: Vector2[] = [
      { x: 0.51, y: 0.49 }, // Close to A
      { x: 0.2, y: 0.2 },   // New player
    ];

    const result = solveAssignment(tracks, markers, 0.2);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].trackId).toBe('A');
    expect(result.assignments[0].markerIndex).toBe(0);
    expect(result.unassignedMarkers).toEqual([1]);
  });

  it('handles more tracks than markers (players disappear)', () => {
    const tracks = new Map<string, Vector2>([
      ['A', { x: 0.1, y: 0.1 }],
      ['B', { x: 0.9, y: 0.9 }],
    ]);
    const markers: Vector2[] = [{ x: 0.12, y: 0.08 }];

    const result = solveAssignment(tracks, markers, 0.2);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].trackId).toBe('A');
    expect(result.unassignedTracks).toEqual(['B']);
  });

  it('handles equal numbers of tracks and markers', () => {
    const tracks = new Map<string, Vector2>([
      ['A', { x: 0.3, y: 0.3 }],
      ['B', { x: 0.7, y: 0.7 }],
      ['C', { x: 0.5, y: 0.1 }],
    ]);
    const markers: Vector2[] = [
      { x: 0.31, y: 0.29 },
      { x: 0.69, y: 0.72 },
      { x: 0.48, y: 0.12 },
    ];

    const result = solveAssignment(tracks, markers, 0.2);
    expect(result.assignments).toHaveLength(3);
    expect(result.unassignedTracks).toEqual([]);
    expect(result.unassignedMarkers).toEqual([]);
  });
});
