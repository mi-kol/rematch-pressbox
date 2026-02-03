/**
 * Basic frame analysis using Claude Haiku.
 * Extracts only essential game state data for cost efficiency.
 *
 * Cost: ~$0.01 per chunk (vs ~$0.02 for Sonnet)
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

const BASIC_MODEL = "claude-3-5-haiku-latest";

// Simplified prompt for basic extraction - minimal tokens
const BASIC_SYSTEM_PROMPT = `You analyze Rematch gameplay frames. Extract ONLY essential data.

HUD Layout:
- Top-left: Timer (MM:SS) and score (GREEN BLUE)
- Center-top: Event text ("Pass +250", "GOAL!", "Save", "Interception +300")
- Chat: Player messages

Return ONLY valid JSON array, one object per frame:
[{
  "timestamp": "MM:SS",
  "score": {"green": N, "blue": N},
  "events": ["GOAL","PASS","SAVE","INTERCEPTION","ASSIST"],
  "eventText": "exact text or null",
  "ballCarrier": "PlayerName or null",
  "chat": [{"player":"name","msg":"text"}]
}]

Be precise. Use null for unclear data. No commentary.`;

/**
 * Encode image to base64.
 */
function encodeImageToBase64(imagePath) {
  return fs.readFileSync(imagePath).toString("base64");
}

/**
 * Analyze a chunk of frames using Haiku.
 *
 * @param {Anthropic} client - Anthropic client
 * @param {string[]} framePaths - Array of frame file paths
 * @param {number} chunkIndex - Index for logging
 * @param {number} totalChunks - Total chunks for logging
 * @returns {Promise<object>} Parsed analysis result
 */
export async function analyzeChunkBasic(client, framePaths, chunkIndex, totalChunks) {
  console.log(`[basic] Analyzing chunk ${chunkIndex + 1}/${totalChunks} (${framePaths.length} frames)...`);

  const content = [];

  content.push({
    type: "text",
    text: `Extract game state from these ${framePaths.length} frames:`,
  });

  for (let i = 0; i < framePaths.length; i++) {
    const framePath = framePaths[i];
    const frameNum = path.basename(framePath, ".jpg").replace("frame_", "");

    content.push({
      type: "text",
      text: `Frame ${frameNum}:`,
    });

    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: encodeImageToBase64(framePath),
      },
    });
  }

  const response = await client.messages.create({
    model: BASIC_MODEL,
    max_tokens: 2048, // Reduced from 4096 - basic output is smaller
    system: BASIC_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const responseText = response.content[0].text;

  try {
    return JSON.parse(responseText);
  } catch {
    // Try to extract JSON from markdown code block
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    console.warn(`[basic] Could not parse JSON for chunk ${chunkIndex + 1}`);
    return { raw: responseText, parseError: true };
  }
}

/**
 * Detect goal events from basic analysis results.
 * Returns frame indices where goals were detected.
 *
 * @param {object[]} basicResults - Array of chunk results
 * @returns {object[]} Array of goal events with chunk/frame info
 */
export function detectGoals(basicResults) {
  const goals = [];
  let prevScore = null;

  for (let chunkIdx = 0; chunkIdx < basicResults.length; chunkIdx++) {
    const chunk = basicResults[chunkIdx];
    if (!chunk.analysis || chunk.analysis.parseError) continue;

    const frames = Array.isArray(chunk.analysis) ? chunk.analysis : chunk.analysis.frames || [];

    for (let frameIdx = 0; frameIdx < frames.length; frameIdx++) {
      const frame = frames[frameIdx];
      if (!frame || !frame.score) continue;

      // Check for score change
      if (prevScore) {
        const greenDiff = (frame.score.green || 0) - (prevScore.green || 0);
        const blueDiff = (frame.score.blue || 0) - (prevScore.blue || 0);

        if (greenDiff > 0 || blueDiff > 0) {
          goals.push({
            chunkIndex: chunkIdx,
            frameIndex: frameIdx,
            timestamp: frame.timestamp,
            scorer: greenDiff > 0 ? "green" : "blue",
            newScore: { ...frame.score },
            events: frame.events || [],
          });
        }
      }

      // Check for GOAL event in events array
      if (frame.events && frame.events.includes("GOAL") && !goals.find(g => g.chunkIndex === chunkIdx && g.frameIndex === frameIdx)) {
        goals.push({
          chunkIndex: chunkIdx,
          frameIndex: frameIdx,
          timestamp: frame.timestamp,
          scorer: "unknown",
          newScore: frame.score ? { ...frame.score } : null,
          events: frame.events,
        });
      }

      prevScore = frame.score;
    }
  }

  return goals;
}

/**
 * Aggregate statistics from basic analysis.
 *
 * @param {object[]} basicResults - Array of chunk results
 * @returns {object} Aggregated stats
 */
export function aggregateStats(basicResults) {
  const stats = {
    totalFrames: 0,
    finalScore: null,
    events: {
      goals: 0,
      passes: 0,
      saves: 0,
      interceptions: 0,
      assists: 0,
    },
    chatMessages: [],
  };

  for (const chunk of basicResults) {
    if (!chunk.analysis || chunk.analysis.parseError) continue;

    const frames = Array.isArray(chunk.analysis) ? chunk.analysis : chunk.analysis.frames || [];
    stats.totalFrames += frames.length;

    for (const frame of frames) {
      if (!frame) continue;

      // Track final score
      if (frame.score) {
        stats.finalScore = frame.score;
      }

      // Count events
      if (frame.events) {
        for (const event of frame.events) {
          const eventLower = event.toLowerCase();
          if (eventLower.includes("goal")) stats.events.goals++;
          if (eventLower.includes("pass")) stats.events.passes++;
          if (eventLower.includes("save")) stats.events.saves++;
          if (eventLower.includes("interception")) stats.events.interceptions++;
          if (eventLower.includes("assist")) stats.events.assists++;
        }
      }

      // Collect chat
      if (frame.chat && Array.isArray(frame.chat)) {
        stats.chatMessages.push(...frame.chat);
      }
    }
  }

  return stats;
}
