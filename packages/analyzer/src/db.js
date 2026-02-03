/**
 * SQLite database for storing analyzer results.
 * Zero hosting cost - all data stored locally.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DEFAULT_DB_PATH = "./data/analyzer.db";

let db = null;

/**
 * Initialize the database connection and create tables if needed.
 *
 * @param {string} dbPath - Path to SQLite database file
 * @returns {Database} SQLite database instance
 */
export function initDb(dbPath = DEFAULT_DB_PATH) {
  if (db) return db;

  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL"); // Better performance

  // Create tables
  db.exec(`
    -- Match analyses
    CREATE TABLE IF NOT EXISTS match_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT UNIQUE,
      video_path TEXT,
      analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      fps INTEGER,
      chunk_size INTEGER,
      total_frames INTEGER,
      final_score_green INTEGER,
      final_score_blue INTEGER,
      narrative TEXT,
      raw_data TEXT
    );

    -- Frame events (for querying specific events)
    CREATE TABLE IF NOT EXISTS frame_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER REFERENCES match_analyses(id),
      frame_index INTEGER,
      timestamp TEXT,
      event_type TEXT,
      event_text TEXT,
      score_green INTEGER,
      score_blue INTEGER,
      ball_carrier TEXT,
      UNIQUE(analysis_id, frame_index, event_type)
    );

    -- Goal details (deep analysis from Sonnet)
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER REFERENCES match_analyses(id),
      timestamp TEXT,
      scoring_team TEXT,
      score_after_green INTEGER,
      score_after_blue INTEGER,
      description TEXT,
      buildup TEXT,
      key_pass TEXT,
      finish_quality TEXT,
      defensive_error TEXT,
      excitement INTEGER
    );

    -- Aggregated player statistics
    CREATE TABLE IF NOT EXISTS player_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_name TEXT,
      match_id TEXT,
      analysis_id INTEGER REFERENCES match_analyses(id),
      goals INTEGER DEFAULT 0,
      assists INTEGER DEFAULT 0,
      passes INTEGER DEFAULT 0,
      saves INTEGER DEFAULT 0,
      interceptions INTEGER DEFAULT 0,
      rating REAL,
      notes TEXT,
      UNIQUE(player_name, match_id)
    );

    -- Tactical summaries
    CREATE TABLE IF NOT EXISTS tactical_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER REFERENCES match_analyses(id),
      phase TEXT,
      formation TEXT,
      attacking_style TEXT,
      defending_style TEXT,
      dominant_areas TEXT,
      weak_areas TEXT,
      notes TEXT
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_events_type ON frame_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_analysis ON frame_events(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_goals_analysis ON goals(analysis_id);
    CREATE INDEX IF NOT EXISTS idx_player_stats_player ON player_stats(player_name);
  `);

  return db;
}

/**
 * Save a complete analysis result to the database.
 *
 * @param {string} matchId - Unique match identifier
 * @param {object} analysis - Full analysis result
 * @returns {number} Database row ID
 */
export function saveAnalysis(matchId, analysis) {
  const db = initDb();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO match_analyses
    (match_id, video_path, fps, chunk_size, total_frames, final_score_green, final_score_blue, narrative, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    matchId,
    analysis.metadata?.videoPath || null,
    analysis.metadata?.fps || null,
    analysis.metadata?.chunkSize || null,
    analysis.metadata?.totalFrames || null,
    analysis.stats?.finalScore?.green || null,
    analysis.stats?.finalScore?.blue || null,
    analysis.narrative || null,
    JSON.stringify(analysis)
  );

  const analysisId = result.lastInsertRowid;

  // Save frame events
  if (analysis.chunks) {
    saveFrameEvents(analysisId, analysis.chunks);
  }

  // Save goals
  if (analysis.goals) {
    saveGoals(analysisId, analysis.goals);
  }

  // Save stats
  if (analysis.stats) {
    saveAggregateStats(matchId, analysisId, analysis.stats);
  }

  return analysisId;
}

/**
 * Save frame events from chunks.
 */
function saveFrameEvents(analysisId, chunks) {
  const db = initDb();

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO frame_events
    (analysis_id, frame_index, timestamp, event_type, event_text, score_green, score_blue, ball_carrier)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let frameIndex = 0;

  for (const chunk of chunks) {
    if (!chunk.analysis || chunk.analysis.parseError) continue;

    const frames = Array.isArray(chunk.analysis) ? chunk.analysis : chunk.analysis.frames || [];

    for (const frame of frames) {
      if (!frame) continue;

      // Save each event type found in this frame
      const events = frame.events || [];
      if (events.length === 0) {
        // Still save frame with null event for timeline
        stmt.run(
          analysisId,
          frameIndex,
          frame.timestamp || null,
          null,
          frame.eventText || null,
          frame.score?.green || null,
          frame.score?.blue || null,
          frame.ballCarrier || null
        );
      } else {
        for (const event of events) {
          stmt.run(
            analysisId,
            frameIndex,
            frame.timestamp || null,
            event,
            frame.eventText || null,
            frame.score?.green || null,
            frame.score?.blue || null,
            frame.ballCarrier || null
          );
        }
      }

      frameIndex++;
    }
  }
}

/**
 * Save goal details.
 */
function saveGoals(analysisId, goals) {
  const db = initDb();

  const stmt = db.prepare(`
    INSERT INTO goals
    (analysis_id, timestamp, scoring_team, score_after_green, score_after_blue, description, buildup, key_pass, finish_quality, defensive_error, excitement)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const goal of goals) {
    stmt.run(
      analysisId,
      goal.timestamp || null,
      goal.scorer || null,
      goal.newScore?.green || null,
      goal.newScore?.blue || null,
      goal.analysis?.goalDescription || null,
      goal.analysis?.buildup || null,
      goal.analysis?.keyPass || null,
      goal.analysis?.finish || null,
      goal.analysis?.defensiveError || null,
      goal.analysis?.excitement || null
    );
  }
}

/**
 * Save aggregate stats (placeholder for player-level stats).
 */
function saveAggregateStats(matchId, analysisId, stats) {
  // For now, just save team-level stats
  // Player-level stats would require more sophisticated extraction
  const db = initDb();

  // Could be expanded to track individual players
  // For now, this is a placeholder
}

/**
 * Get analysis for a match.
 *
 * @param {string} matchId - Match identifier
 * @returns {object|null} Analysis data
 */
export function getAnalysis(matchId) {
  const db = initDb();

  const row = db.prepare("SELECT * FROM match_analyses WHERE match_id = ?").get(matchId);
  if (!row) return null;

  return {
    ...row,
    raw_data: row.raw_data ? JSON.parse(row.raw_data) : null,
  };
}

/**
 * Get all goals for a match.
 *
 * @param {number} analysisId - Analysis row ID
 * @returns {object[]} Array of goals
 */
export function getGoals(analysisId) {
  const db = initDb();
  return db.prepare("SELECT * FROM goals WHERE analysis_id = ?").all(analysisId);
}

/**
 * Get aggregate statistics across all matches.
 *
 * @returns {object} Aggregate stats
 */
export function getAggregateStats() {
  const db = initDb();

  const totalMatches = db.prepare("SELECT COUNT(*) as count FROM match_analyses").get();

  const totalGoals = db.prepare("SELECT COUNT(*) as count FROM goals").get();

  const avgScore = db.prepare(`
    SELECT AVG(final_score_green) as avgGreen, AVG(final_score_blue) as avgBlue
    FROM match_analyses
    WHERE final_score_green IS NOT NULL
  `).get();

  const eventCounts = db.prepare(`
    SELECT event_type, COUNT(*) as count
    FROM frame_events
    WHERE event_type IS NOT NULL
    GROUP BY event_type
  `).all();

  return {
    totalMatches: totalMatches.count,
    totalGoals: totalGoals.count,
    averageScore: {
      green: avgScore.avgGreen,
      blue: avgScore.avgBlue,
    },
    eventCounts: Object.fromEntries(eventCounts.map((e) => [e.event_type, e.count])),
  };
}

/**
 * Get recent analyses.
 *
 * @param {number} limit - Max results
 * @returns {object[]} Recent analyses
 */
export function getRecentAnalyses(limit = 10) {
  const db = initDb();
  return db
    .prepare(
      `SELECT id, match_id, video_path, analyzed_at, final_score_green, final_score_blue
       FROM match_analyses ORDER BY analyzed_at DESC LIMIT ?`
    )
    .all(limit);
}

/**
 * Close database connection.
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
