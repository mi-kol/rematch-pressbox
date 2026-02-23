declare module 'munkres-js' {
  /**
   * Hungarian algorithm for optimal assignment.
   * Takes a cost matrix and returns the optimal assignment as [row, col] pairs.
   */
  function munkres(costMatrix: number[][]): [number, number][];
  export = munkres;
}
