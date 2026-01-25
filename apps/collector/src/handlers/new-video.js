import fs from "fs/promises";
import path from "path";

/**
 * Handle a new video file detected by the watcher.
 * Creates video and match records in Supabase.
 *
 * @param {string} filePath - Absolute path to the MP4 file
 * @param {object} ctx - Application context
 * @param {object} ctx.sb - Supabase client
 * @param {object} ctx.cfg - Configuration
 * @param {object} ctx.sessionManager - SessionManager instance
 */
export async function handleNewVideo(filePath, ctx) {
  const { sb, cfg, sessionManager } = ctx;

  try {
    // 1. Check if video already exists in DB (by file_path)
    const { data: existing } = await sb
      .from("videos")
      .select("id")
      .eq("file_path", filePath)
      .maybeSingle();

    if (existing) {
      console.log(`[new-video] already processed: ${filePath}`);
      return;
    }

    // 2. Extract file metadata
    const stats = await fs.stat(filePath);
    const fileName = path.basename(filePath);
    const recordedAt = stats.mtime; // Use file modification time as recording time

    console.log(`[new-video] processing: ${fileName}`);

    // 3. Insert into videos table
    const { data: video, error: videoError } = await sb
      .from("videos")
      .insert({
        league_id: cfg.leagueId,
        file_path: filePath,
        file_name: fileName,
        file_size_bytes: stats.size,
        recorded_at: recordedAt.toISOString(),
        source: "medal",
      })
      .select("*")
      .single();

    if (videoError) {
      throw new Error(`Failed to create video record: ${videoError.message}`);
    }

    console.log(`[new-video] created video record ${video.id}`);

    // 4. Get or create session
    const session = await sessionManager.getOrCreateSession(recordedAt);

    // 5. Calculate match_index
    const matchIndex = await sessionManager.getNextMatchIndex(session.id);

    // 6. Insert match record
    const { data: match, error: matchError } = await sb
      .from("matches")
      .insert({
        league_id: cfg.leagueId,
        session_id: session.id,
        video_id: video.id,
        match_index: matchIndex,
        score_confidence: "pending",
        score_coverage: 0,
      })
      .select("*")
      .single();

    if (matchError) {
      throw new Error(`Failed to create match record: ${matchError.message}`);
    }

    console.log(
      `[new-video] created match ${matchIndex} in session ${session.id} for ${fileName}`
    );
  } catch (err) {
    console.error(`[new-video] failed to process ${filePath}:`, err.message);
    // Don't re-throw - we want the watcher to continue
  }
}

/**
 * Check if a video file has already been processed.
 *
 * @param {object} sb - Supabase client
 * @param {string} filePath - Absolute path to check
 * @returns {Promise<boolean>}
 */
export async function isVideoProcessed(sb, filePath) {
  const { data } = await sb
    .from("videos")
    .select("id")
    .eq("file_path", filePath)
    .maybeSingle();

  return !!data;
}
