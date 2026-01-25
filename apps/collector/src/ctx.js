import { sbAdmin } from "../../../packages/core/src/db.js";

export async function buildCtx() {
  const sb = sbAdmin();

  // Get the single league (following discord-bot pattern)
  const { data: league, error } = await sb.from("leagues").select("id").limit(1).single();
  if (error) throw new Error(`Failed to fetch league: ${error.message}`);

  return {
    sb,
    cfg: {
      medalClipsPath: process.env.MEDAL_CLIPS_PATH,
      sessionGapMinutes: parseInt(process.env.SESSION_GAP_MINUTES || "30", 10),
      leagueId: league.id,
    },
  };
}
