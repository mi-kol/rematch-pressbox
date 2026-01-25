import chokidar from "chokidar";
import path from "path";

/**
 * Create a filesystem watcher for MP4 files in the Medal clips directory.
 *
 * @param {string} watchPath - Directory to watch
 * @param {object} options - Watcher options
 * @param {boolean} options.usePolling - Use polling (may be needed for network drives)
 * @returns {object} Watcher control object
 */
export function createWatcher(watchPath, options = {}) {
  const watcher = chokidar.watch(path.join(watchPath, "**/*.mp4"), {
    persistent: true,
    ignoreInitial: true, // Don't fire for existing files on startup
    awaitWriteFinish: {
      stabilityThreshold: 2000, // Wait 2s after last write
      pollInterval: 500,
    },
    usePolling: options.usePolling || false,
    depth: 5, // Limit directory depth
  });

  return {
    watcher,

    /**
     * Start listening for new files
     * @param {function} onAdd - Callback when new MP4 is detected
     * @param {function} onError - Callback for errors
     */
    start(onAdd, onError) {
      watcher.on("add", (filePath) => {
        // Only process .mp4 files (double-check extension)
        if (path.extname(filePath).toLowerCase() === ".mp4") {
          onAdd(filePath);
        }
      });

      watcher.on("error", (err) => {
        if (onError) {
          onError(err);
        } else {
          console.error("[watcher] error:", err);
        }
      });

      watcher.on("ready", () => {
        console.log(`[watcher] watching ${watchPath} for new MP4 files`);
      });

      return watcher;
    },

    /**
     * Stop the watcher
     */
    async stop() {
      await watcher.close();
      console.log("[watcher] stopped");
    },
  };
}
