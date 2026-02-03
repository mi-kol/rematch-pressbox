/**
 * SessionManager handles grouping videos into sessions based on time proximity.
 * If videos arrive within the configured gap (default 30 minutes), they belong
 * to the same session. Otherwise, a new session is created.
 */
export class SessionManager {
  /**
   * @param {object} sb - Supabase client
   * @param {string} leagueId - League UUID
   * @param {number} gapMinutes - Minutes between recordings to consider same session
   */
  constructor(sb, leagueId, gapMinutes = 30) {
    this.sb = sb;
    this.leagueId = leagueId;
    this.gapMs = gapMinutes * 60 * 1000;
    this.activeSession = null; // In-memory cache for performance
    this.matchIndexCache = new Map(); // session_id -> next index (prevents race conditions)
    this.processingLock = Promise.resolve(); // Serializes video processing
  }

  /**
   * Acquire a lock to serialize operations.
   * Returns a release function to call when done.
   */
  async acquireLock() {
    let release;
    const newLock = new Promise((resolve) => {
      release = resolve;
    });
    const oldLock = this.processingLock;
    this.processingLock = newLock;
    await oldLock;
    return release;
  }

  /**
   * Get or create a session for the given video timestamp.
   * Uses a hybrid approach: DB queries for durability, in-memory cache for performance.
   *
   * @param {Date} videoTimestamp - When the video was recorded
   * @returns {Promise<object>} The session record
   */
  async getOrCreateSession(videoTimestamp) {
    const videoTime = videoTimestamp.getTime();

    // Check if cached active session is still valid
    if (this.activeSession) {
      const lastMatchTime = await this.getLastMatchTime(this.activeSession.id);
      if (lastMatchTime && videoTime - lastMatchTime < this.gapMs) {
        return this.activeSession;
      }
    }

    // Query DB for recent session (handles restarts)
    const recentSession = await this.findRecentSession(videoTimestamp);
    if (recentSession) {
      this.activeSession = recentSession;
      return recentSession;
    }

    // Create new session
    const newSession = await this.createSession(videoTimestamp);
    this.activeSession = newSession;
    return newSession;
  }

  /**
   * Find a recent session that this video could belong to.
   * Looks for sessions started within the gap window where source = 'collector'.
   */
  async findRecentSession(videoTimestamp) {
    const cutoff = new Date(videoTimestamp.getTime() - this.gapMs).toISOString();

    const { data, error } = await this.sb
      .from("sessions")
      .select("*")
      .eq("league_id", this.leagueId)
      .eq("source", "collector")
      .gte("started_at", cutoff)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[session-manager] findRecentSession error:", error);
      return null;
    }

    return data;
  }

  /**
   * Get the timestamp of the last match in a session.
   */
  async getLastMatchTime(sessionId) {
    const { data, error } = await this.sb
      .from("matches")
      .select("created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return new Date(data.created_at).getTime();
  }

  /**
   * Create a new session.
   */
  async createSession(startedAt) {
    const { data, error } = await this.sb
      .from("sessions")
      .insert({
        league_id: this.leagueId,
        status: "new",
        source: "collector",
        started_at: startedAt.toISOString(),
      })
      .select("*")
      .single();

    if (error) throw new Error(`Failed to create session: ${error.message}`);

    console.log(`[session-manager] created new session ${data.id}`);
    return data;
  }

  /**
   * Get the next match index for a session.
   * Uses an in-memory cache to prevent race conditions when multiple
   * videos are processed concurrently.
   */
  async getNextMatchIndex(sessionId) {
    // Check cache first
    if (this.matchIndexCache.has(sessionId)) {
      const nextIndex = this.matchIndexCache.get(sessionId);
      this.matchIndexCache.set(sessionId, nextIndex + 1);
      return nextIndex;
    }

    // Query DB to initialize cache
    const { count, error } = await this.sb
      .from("matches")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);

    if (error) {
      console.error("[session-manager] getNextMatchIndex error:", error);
      return 1;
    }

    const nextIndex = (count || 0) + 1;
    this.matchIndexCache.set(sessionId, nextIndex + 1);
    return nextIndex;
  }

  /**
   * Clear the match index cache for a session.
   * Call this if you need to re-sync with the database.
   */
  clearMatchIndexCache(sessionId) {
    if (sessionId) {
      this.matchIndexCache.delete(sessionId);
    } else {
      this.matchIndexCache.clear();
    }
  }
}
