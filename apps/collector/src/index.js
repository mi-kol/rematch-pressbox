import "dotenv/config";
import { glob } from "glob";
import path from "path";

import { buildCtx } from "./ctx.js";
import { createWatcher } from "./watcher.js";
import { SessionManager } from "./session-manager.js";
import { handleNewVideo, isVideoProcessed } from "./handlers/new-video.js";

/**
 * Process any MP4 files that were added while the collector was offline.
 */
async function processExistingFiles(ctx) {
  const { sb, cfg } = ctx;

  console.log(`[startup] scanning for missed files in ${cfg.medalClipsPath}`);

  // Find all MP4 files in the watch directory
  const pattern = path.join(cfg.medalClipsPath, "**/*.mp4").replace(/\\/g, "/");
  const files = await glob(pattern);

  if (files.length === 0) {
    console.log("[startup] no MP4 files found");
    return;
  }

  console.log(`[startup] found ${files.length} MP4 files, checking for unprocessed...`);

  let processed = 0;
  for (const filePath of files) {
    const alreadyProcessed = await isVideoProcessed(sb, filePath);
    if (!alreadyProcessed) {
      await handleNewVideo(filePath, ctx);
      processed++;
    }
  }

  if (processed > 0) {
    console.log(`[startup] processed ${processed} missed files`);
  } else {
    console.log("[startup] all files already processed");
  }
}

async function main() {
  // Validate required env vars
  if (!process.env.MEDAL_CLIPS_PATH) {
    console.error("MEDAL_CLIPS_PATH environment variable is required");
    process.exit(1);
  }

  console.log("[collector] starting...");

  // Build context
  const ctx = await buildCtx();
  const { cfg } = ctx;

  // Create session manager and attach to context
  ctx.sessionManager = new SessionManager(ctx.sb, cfg.leagueId, cfg.sessionGapMinutes);

  console.log(`[collector] league: ${cfg.leagueId}`);
  console.log(`[collector] watching: ${cfg.medalClipsPath}`);
  console.log(`[collector] session gap: ${cfg.sessionGapMinutes} minutes`);

  // Process any files that were added while collector was offline
  await processExistingFiles(ctx);

  // Start watching for new files
  const watcher = createWatcher(cfg.medalClipsPath);
  watcher.start(
    (filePath) => handleNewVideo(filePath, ctx),
    (err) => console.error("[collector] watcher error:", err)
  );

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[collector] received ${signal}, shutting down...`);
    await watcher.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("[collector] ready");
}

main().catch((err) => {
  console.error("[collector] fatal error:", err);
  process.exit(1);
});
