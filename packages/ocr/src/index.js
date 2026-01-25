export { extractEndFrames, cleanupFrames } from "./extract-frames.js";
export { readScore } from "./read-score.js";

/**
 * Extract score from a video file.
 * Convenience function that combines frame extraction and OCR.
 *
 * @param {string} videoPath - Path to the video file
 * @param {object} options - Options for extraction
 * @param {boolean} options.keepFrames - If true, don't clean up frames after (default: false)
 * @returns {Promise<ScoreResult>} The score extraction result
 */
export async function extractScoreFromVideo(videoPath, options = {}) {
  const { extractEndFrames, cleanupFrames } = await import("./extract-frames.js");
  const { readScore } = await import("./read-score.js");

  const { keepFrames = false, ...extractOptions } = options;

  // Extract frames from end of video
  const { frames, outputDir } = await extractEndFrames(videoPath, extractOptions);

  try {
    // Run OCR on frames
    const result = await readScore(frames);
    return result;
  } finally {
    // Clean up unless asked to keep
    if (!keepFrames) {
      await cleanupFrames(outputDir);
    }
  }
}
