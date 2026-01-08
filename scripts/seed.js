import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

import { LEAGUE_NAME, SEASON } from "./seed-data/league.js";
import { JOURNALISTS } from "./seed-data/journalists.js";
import { PRESS_QUESTIONS } from "./seed-data/press-questions.js";

function sbAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

const sb = sbAdmin();

async function upsertLeague() {
  const { data, error } = await sb
    .from("leagues")
    .upsert({ name: LEAGUE_NAME }, { onConflict: "name" })
    .select("id,name")
    .single();

  if (error) throw error;
  return data;
}

async function upsertSeason(leagueId) {
  const payload = { league_id: leagueId, ...SEASON };

  const { data, error } = await sb
    .from("seasons")
    .upsert(payload, { onConflict: "league_id,name" })
    .select("id,league_id,name,status")
    .single();

  if (error) throw error;
  return data;
}

async function upsertJournalists(leagueId) {
  const rows = JOURNALISTS.map((j) => ({
    league_id: leagueId,
    name: j.name,
    slug: j.slug,
    persona: j.persona ?? {},
    active: true,
  }));

  const { data, error } = await sb
    .from("journalists")
    .upsert(rows, { onConflict: "league_id,slug" })
    .select("id,name,slug");

  if (error) throw error;
  return data;
}

async function upsertPressQuestions(leagueId) {
  const rows = PRESS_QUESTIONS.map((q) => ({
    league_id: leagueId,
    tag: q.tag,
    template: q.template,
    weight: q.weight ?? 1,
    active: true,
    min_version: q.min_version ?? null,
  }));

  const { data, error } = await sb
    .from("press_questions")
    .upsert(rows, { onConflict: "league_id,tag,template" })
    .select("id,tag");

  if (error) throw error;
  return data;
}

async function main() {
  const league = await upsertLeague();
  const season = await upsertSeason(league.id);
  const journalists = await upsertJournalists(league.id);
  const questions = await upsertPressQuestions(league.id);

  console.log("seed complete:");
  console.log("- league:", league);
  console.log("- season:", season);
  console.log("- journalists:", journalists.length);
  console.log("- press questions:", questions.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
