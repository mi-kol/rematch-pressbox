/**
 * Hungarian algorithm for optimal assignment.
 * Used to match detected markers to existing tracks.
 */

import munkres from 'munkres-js';
import type { Vector2 } from '../types.js';

export interface AssignmentResult {
  assignments: Array<{ trackId: string; markerIndex: number }>;
  unassignedTracks: string[];
  unassignedMarkers: number[];
}

/**
 * Build cost matrix for track-to-marker assignment.
 * Cost is based on distance and color similarity.
 */
export function buildCostMatrix(
  trackPositions: Map<string, Vector2>,
  markerPositions: Vector2[],
  maxDistance: number = 0.2
): { matrix: number[][]; trackIds: string[] } {
  const trackIds = Array.from(trackPositions.keys());
  const matrix: number[][] = [];

  for (const trackId of trackIds) {
    const trackPos = trackPositions.get(trackId)!;
    const row: number[] = [];

    for (const markerPos of markerPositions) {
      const distance = Math.hypot(
        markerPos.x - trackPos.x,
        markerPos.y - trackPos.y
      );

      // Use large cost for impossible assignments
      if (distance > maxDistance) {
        row.push(1000000);
      } else {
        row.push(distance);
      }
    }

    matrix.push(row);
  }

  return { matrix, trackIds };
}

/**
 * Solve the assignment problem using the Hungarian algorithm.
 */
export function solveAssignment(
  trackPositions: Map<string, Vector2>,
  markerPositions: Vector2[],
  maxDistance: number = 0.2
): AssignmentResult {
  if (trackPositions.size === 0 || markerPositions.length === 0) {
    return {
      assignments: [],
      unassignedTracks: Array.from(trackPositions.keys()),
      unassignedMarkers: markerPositions.map((_, i) => i),
    };
  }

  const { matrix, trackIds } = buildCostMatrix(trackPositions, markerPositions, maxDistance);

  // Pad matrix to be square if needed
  const rows = matrix.length;
  const cols = markerPositions.length;
  const size = Math.max(rows, cols);

  const paddedMatrix: number[][] = [];
  for (let i = 0; i < size; i++) {
    const row: number[] = [];
    for (let j = 0; j < size; j++) {
      if (i < rows && j < cols) {
        row.push(matrix[i][j]);
      } else {
        row.push(1000000); // Dummy entries
      }
    }
    paddedMatrix.push(row);
  }

  // Solve with munkres
  const solution = munkres(paddedMatrix);

  // Parse results
  const assignments: AssignmentResult['assignments'] = [];
  const assignedTracks = new Set<string>();
  const assignedMarkers = new Set<number>();

  for (const [row, col] of solution) {
    if (row < trackIds.length && col < markerPositions.length) {
      const cost = matrix[row][col];
      if (cost < 1000000) {
        assignments.push({
          trackId: trackIds[row],
          markerIndex: col,
        });
        assignedTracks.add(trackIds[row]);
        assignedMarkers.add(col);
      }
    }
  }

  const unassignedTracks = trackIds.filter(id => !assignedTracks.has(id));
  const unassignedMarkers = markerPositions
    .map((_, i) => i)
    .filter(i => !assignedMarkers.has(i));

  return { assignments, unassignedTracks, unassignedMarkers };
}
