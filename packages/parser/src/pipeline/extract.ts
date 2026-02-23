/**
 * Stage 1: Frame Extraction & Phase Classification
 *
 * - Extracts frames from video at configurable FPS
 * - Classifies game phase (gameplay, goal, kickoff, loading, replay, etc.)
 * - Outputs frames to disk for subsequent stages
 */

import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs/promises';
import type { GamePhase } from '../types.js';

export interface ExtractOptions {
  inputPath: string;
  outputDir: string;
  fps?: number;
  startTime?: number;
  duration?: number;
}

export interface ExtractedFrame {
  path: string;
  frameNumber: number;
  timestampSeconds: number;
}

export interface ExtractionResult {
  frames: ExtractedFrame[];
  metadata: {
    sourceFps: number;
    sampleFps: number;
    duration: number;
    width: number;
    height: number;
  };
}

/**
 * Get video metadata using ffprobe.
 */
export async function getVideoMetadata(videoPath: string): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
}> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) {
        return reject(new Error('No video stream found'));
      }

      // Parse frame rate (could be "30/1" or "29.97" format)
      let fps = 30;
      if (videoStream.r_frame_rate) {
        const parts = videoStream.r_frame_rate.split('/');
        fps = parts.length === 2
          ? parseInt(parts[0]) / parseInt(parts[1])
          : parseFloat(videoStream.r_frame_rate);
      }

      resolve({
        duration: metadata.format.duration || 0,
        width: videoStream.width || 1920,
        height: videoStream.height || 1080,
        fps,
      });
    });
  });
}

/**
 * Extract frames from video file.
 */
export async function extractFrames(options: ExtractOptions): Promise<ExtractionResult> {
  const { inputPath, outputDir, fps = 5, startTime = 0, duration } = options;

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Get video metadata
  const metadata = await getVideoMetadata(inputPath);
  const endTime = duration ? startTime + duration : metadata.duration;

  console.log(`[extract] Video: ${metadata.width}x${metadata.height} @ ${metadata.fps.toFixed(2)}fps`);
  console.log(`[extract] Duration: ${metadata.duration.toFixed(1)}s, extracting ${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s @ ${fps}fps`);

  // Extract frames
  return new Promise((resolve, reject) => {
    const outputPattern = path.join(outputDir, 'frame_%06d.jpg');

    let cmd = ffmpeg(inputPath)
      .setStartTime(startTime)
      .outputOptions([
        `-vf fps=${fps}`,
        '-q:v 2',  // High quality JPEG
      ])
      .output(outputPattern);

    if (duration) {
      cmd = cmd.duration(duration);
    }

    cmd
      .on('end', async () => {
        // Read extracted frames
        const files = await fs.readdir(outputDir);
        const frameFiles = files
          .filter(f => f.startsWith('frame_') && f.endsWith('.jpg'))
          .sort();

        const frames: ExtractedFrame[] = frameFiles.map((file, index) => ({
          path: path.join(outputDir, file),
          frameNumber: index,
          timestampSeconds: startTime + (index / fps),
        }));

        console.log(`[extract] Extracted ${frames.length} frames`);

        resolve({
          frames,
          metadata: {
            sourceFps: metadata.fps,
            sampleFps: fps,
            duration: metadata.duration,
            width: metadata.width,
            height: metadata.height,
          },
        });
      })
      .on('error', (err) => {
        console.error('[extract] FFmpeg error:', err);
        reject(err);
      })
      .run();
  });
}

/**
 * Classify game phase from a frame.
 * TODO: Implement phase detection logic
 */
export function classifyPhase(_framePath: string): { phase: GamePhase; confidence: number } {
  // Placeholder - will analyze frame to determine game phase
  return {
    phase: 'gameplay',
    confidence: 0.5,
  };
}
