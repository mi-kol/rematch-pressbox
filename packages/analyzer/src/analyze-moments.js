/**
 * Deep analysis of key moments using Claude Sonnet.
 * Only called for goals, tactical summaries, and narrative generation.
 *
 * Cost: ~$0.02-0.03 per call (used sparingly)
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

const ADVANCED_MODEL = "claude-sonnet-4-20250514";

// Detailed prompt for goal sequence analysis
const GOAL_ANALYSIS_PROMPT = `You are an expert soccer analyst reviewing a goal sequence from Rematch (a 3D arena soccer game).

Analyze these frames showing a goal being scored. Provide:
1. Build-up play description
2. Key pass or assist
3. Finish quality
4. Defensive breakdown (what went wrong for the defending team)
5. Player performances in the sequence

Return JSON:
{
  "goalDescription": "2-3 sentence vivid description of the goal",
  "buildup": "how the attack developed",
  "keyPass": "description of the assist/key pass if any",
  "finish": "quality of the finish (clinical/scrappy/lucky/etc)",
  "defensiveError": "what the defense did wrong",
  "playerRatings": [{"player": "name", "rating": 1-10, "contribution": "what they did"}],
  "excitement": 1-10
}`;

// Prompt for tactical phase summary
const TACTICAL_SUMMARY_PROMPT = `You are a soccer tactician analyzing a phase of play from Rematch.

Based on the game data provided, summarize:
1. Overall team shape and formation
2. Attacking patterns used
3. Defensive organization
4. Key battles and 1v1s
5. Areas of dominance/weakness

Return JSON:
{
  "phase": "attacking/defending/balanced",
  "formation": "description of shape",
  "attackingStyle": "direct/possession/counter",
  "defendingStyle": "high-press/mid-block/low-block",
  "keyBattles": ["battle 1", "battle 2"],
  "dominantAreas": ["area 1"],
  "weakAreas": ["area 1"],
  "tacticalNotes": "2-3 sentences of tactical insight"
}`;

// Prompt for narrative generation
const NARRATIVE_PROMPT = `You are a sports journalist writing a match report for a Rematch game (3D arena soccer).

Based on the game data, write an engaging 3-4 paragraph match report. Include:
- Final score and key storyline
- Goal descriptions with drama and excitement
- Key player performances
- Tactical observations
- A memorable quote or moment

Write in the style of a professional sports article. Be vivid and engaging.`;

/**
 * Encode image to base64.
 */
function encodeImageToBase64(imagePath) {
  return fs.readFileSync(imagePath).toString("base64");
}

/**
 * Analyze a goal sequence in detail using Sonnet.
 *
 * @param {Anthropic} client - Anthropic client
 * @param {string[]} framePaths - Frames around the goal (typically 5-10 frames)
 * @param {object} goalContext - Context about the goal from basic analysis
 * @returns {Promise<object>} Detailed goal analysis
 */
export async function analyzeGoalSequence(client, framePaths, goalContext) {
  console.log(`[moments] Analyzing goal sequence (${framePaths.length} frames)...`);

  const content = [];

  content.push({
    type: "text",
    text: `Goal scored at ${goalContext.timestamp || "unknown time"}. Score: ${JSON.stringify(goalContext.newScore)}. Analyze this goal sequence:`,
  });

  for (let i = 0; i < framePaths.length; i++) {
    const framePath = framePaths[i];
    if (!fs.existsSync(framePath)) continue;

    content.push({
      type: "text",
      text: `Frame ${i + 1}/${framePaths.length}:`,
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
    model: ADVANCED_MODEL,
    max_tokens: 1024,
    system: GOAL_ANALYSIS_PROMPT,
    messages: [{ role: "user", content }],
  });

  const responseText = response.content[0].text;

  try {
    return JSON.parse(responseText);
  } catch {
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    return { raw: responseText, goalContext };
  }
}

/**
 * Generate tactical summary for a portion of the match.
 *
 * @param {Anthropic} client - Anthropic client
 * @param {object} gameData - Aggregated game data from basic analysis
 * @param {string} phase - "first-half", "second-half", or "full-match"
 * @returns {Promise<object>} Tactical summary
 */
export async function generateTacticalSummary(client, gameData, phase = "full-match") {
  console.log(`[moments] Generating tactical summary (${phase})...`);

  const response = await client.messages.create({
    model: ADVANCED_MODEL,
    max_tokens: 1024,
    system: TACTICAL_SUMMARY_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyze this ${phase} data and provide tactical insights:\n\n${JSON.stringify(gameData, null, 2)}`,
      },
    ],
  });

  const responseText = response.content[0].text;

  try {
    return JSON.parse(responseText);
  } catch {
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    return { raw: responseText };
  }
}

/**
 * Generate match narrative/article.
 *
 * @param {Anthropic} client - Anthropic client
 * @param {object} gameLog - Full game log with basic analysis, goals, and stats
 * @returns {Promise<string>} Match narrative
 */
export async function generateNarrative(client, gameLog) {
  console.log(`[moments] Generating match narrative...`);

  const response = await client.messages.create({
    model: ADVANCED_MODEL,
    max_tokens: 2048,
    system: NARRATIVE_PROMPT,
    messages: [
      {
        role: "user",
        content: `Write a match report based on this game data:\n\n${JSON.stringify(gameLog, null, 2)}`,
      },
    ],
  });

  return response.content[0].text;
}

/**
 * Get frames around a goal for sequence analysis.
 * Returns 3 frames before and 2 frames after the goal frame.
 *
 * @param {string[]} allFramePaths - All frame paths
 * @param {number} goalFrameIndex - Index of the goal frame
 * @returns {string[]} Array of frame paths for the sequence
 */
export function getGoalSequenceFrames(allFramePaths, goalFrameIndex) {
  const start = Math.max(0, goalFrameIndex - 3);
  const end = Math.min(allFramePaths.length, goalFrameIndex + 3);
  return allFramePaths.slice(start, end);
}
