import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { randomUUID } from "crypto";

// Set ffmpeg path from the bundled installer
ffmpeg.setFfmpegPath(ffmpegPath.path);

/**
 * Get video metadata using ffprobe.
 */
async function getVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      const video = metadata.streams.find((s) => s.codec_type === "video");
      resolve({
        duration: metadata.format.duration,
        width: video?.width || 1920,
        height: video?.height || 1080,
      });
    });
  });
}

/**
 * Extract frames from the end of a video file, cropped to the score region.
 *
 * @param {string} videoPath - Path to the video file
 * @param {object} options - Extraction options
 * @param {number} options.secondsFromEnd - How many seconds from the end to extract (default: 30)
 * @param {number} options.fps - Frames per second to extract (default: 2)
 * @param {string} options.outputDir - Directory to save frames (default: os.tmpdir())
 * @param {boolean} options.cropToScore - Crop to top-left score region (default: true)
 * @returns {Promise<{ frames: string[], outputDir: string }>} Array of frame file paths and output directory
 */
export async function extractEndFrames(videoPath, options = {}) {
  const {
    secondsFromEnd = 30,
    fps = 2,
    outputDir = path.join(os.tmpdir(), `ocr-frames-${randomUUID()}`),
    cropToScore = true,
  } = options;

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  // Get video metadata
  const { duration, width, height } = await getVideoMetadata(videoPath);
  const startTime = Math.max(0, duration - secondsFromEnd);

  console.log(`[extract-frames] duration: ${duration.toFixed(1)}s, extracting from ${startTime.toFixed(1)}s`);
  console.log(`[extract-frames] video size: ${width}x${height}`);

  // Build video filter
  // The Rematch HUD has: timer (MM:SS) on left, score (X Y) on right with team flags
  // Crop the full HUD bar, then preprocess for better OCR
  let vf = `fps=${fps}`;
  if (cropToScore) {
    // Crop the full HUD area (timer + score) for better OCR context
    const cropW = Math.floor(width * 0.25); // 25% of width (full HUD)
    const cropH = Math.floor(height * 0.08); // 8% height
    const cropY = Math.floor(height * 0.02); // Start 2% from top

    // Preprocessing for better OCR:
    // 1. Crop to HUD region
    // 2. Scale up 3x for better character recognition
    // 3. Negate (invert) colors - HUD is light text on dark background
    // 4. Increase contrast and convert to grayscale
    vf = `crop=${cropW}:${cropH}:0:${cropY},scale=iw*3:ih*3,negate,eq=contrast=1.5,format=gray,${vf}`;
    console.log(`[extract-frames] cropping to HUD region: ${cropW}x${cropH} at (0,${cropY}) with preprocessing`);
  }

  // Extract frames
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .setStartTime(startTime)
      .outputOptions([`-vf ${vf}`, "-q:v 2"])
      .output(path.join(outputDir, "frame_%03d.jpg"))
      .on("end", async () => {
        const files = await fs.readdir(outputDir);
        const framePaths = files
          .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
          .sort()
          .map((f) => path.join(outputDir, f));

        console.log(`[extract-frames] extracted ${framePaths.length} frames`);
        resolve({ frames: framePaths, outputDir });
      })
      .on("error", (err) => {
        console.error("[extract-frames] ffmpeg error:", err);
        reject(err);
      })
      .run();
  });
}

/**
 * Clean up extracted frames directory.
 */
export async function cleanupFrames(outputDir) {
  try {
    await fs.rm(outputDir, { recursive: true, force: true });
    console.log(`[extract-frames] cleaned up ${outputDir}`);
  } catch (err) {
    console.error("[extract-frames] cleanup error:", err);
  }
}
