import { todayISO } from "../../lib/discord.js";

async function getLeague(sb) {
  const { data, error } = await sb.from("leagues").select("*").limit(1).single();
  if (error) throw error;
  return data;
}

async function getLatestSession(sb, leagueId) {
  const { data, error } = await sb
    .from("sessions")
    .select("id, started_at")
    .eq("league_id", leagueId)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (error) throw error;
  return data;
}

async function getLatestPressConfForSession(sb, sessionId) {
  const { data, error } = await sb
    .from("press_conferences")
    .select("id, session_id, journalist_id, started_at")
    .eq("session_id", sessionId)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (error) throw error;
  return data;
}


async function getSession(sb, sessionId) {
  const { data, error } = await sb.from("sessions").select("*").eq("id", sessionId).single();
  if (error) throw error;
  return data;
}

async function getJournalist(sb, journalistId) {
  const { data, error } = await sb.from("journalists").select("*").eq("id", journalistId).single();
  if (error) throw error;
  return data;
}

async function getAnswers(sb, pressConfId) {
  const { data, error } = await sb
    .from("press_answers")
    .select(`discord_user_id, answer, created_at, press_questions(tag, template)`)
    .eq("press_conference_id", pressConfId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function execute(interaction, ctx) {
  const { sb, generateRecapFromPacket, publishToWorld } = ctx;

  await interaction.reply("🛠️ republishing latest presser…");

  const league = await getLeague(sb);
  const latestSession = await getLatestSession(sb, league.id);
  const latest = await getLatestPressConfForSession(sb, latestSession.id);

  const session = await getSession(sb, latest.session_id);
  const journalist = await getJournalist(sb, latest.journalist_id);
  const answers = await getAnswers(sb, latest.id);


  if (!answers.length) {
    await interaction.followUp("no saved answers found on the latest presser.");
    return;
  }

  const quotes = answers.map((a) => ({
    tag: a.press_questions?.tag ?? "general",
    question: a.press_questions?.template ?? "",
    speaker_discord_id: a.discord_user_id,
    text: a.answer
  }));

  const packet = {
    league: { id: league.id, name: league.name },
    session: { id: session.id, started_at: session.started_at },
    match: { title_hint: "knowball matchday notes", our_score: null, opp_score: null, opponent_team_name: null },
    press: { journalist: { id: journalist.id, name: journalist.name, persona: journalist.persona }, quotes }
  };

  const { title, slug, md } = await generateRecapFromPacket(packet);

  const repubSlug = `${slug}-${Date.now().toString().slice(-5)}`;

  const pub = await publishToWorld({
    date: todayISO(),
    slug: repubSlug,
    title,
    md,
    tags: ["recap"],
    author: journalist.name
  });

  await sb.from("articles").insert({
    league_id: league.id,
    session_id: session.id,
    journalist_id: journalist.id,
    type: "recap",
    title,
    slug: repubSlug,
    status: "published",
    content_md: md,
    url: pub.url,
    published_at: new Date().toISOString(),
    meta: { republished_from_press_conference_id: latest.id }
  });

  await interaction.followUp(`📰 republished: ${pub.url}`);
}
