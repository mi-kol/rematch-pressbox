import { todayISO } from "../../lib/discord.js";

async function getLeague(sb) {
  const { data, error } = await sb.from("leagues").select("*").limit(1).single();
  if (error) throw error;
  return data;
}

async function getRandomJournalist(sb, leagueId) {
  const { data, error } = await sb
    .from("journalists")
    .select("*")
    .eq("league_id", leagueId)
    .eq("active", true);
  if (error) throw error;
  if (!data?.length) throw new Error("no active journalists found");
  return data[Math.floor(Math.random() * data.length)];
}

async function getQuestions(sb, leagueId, n = 5) {
  const { data, error } = await sb
    .from("press_questions")
    .select("*")
    .eq("league_id", leagueId)
    .eq("active", true)
    .limit(50);

  if (error) throw error;
  if (!data?.length) throw new Error("no press questions found");

  const pool = [];
  for (const q of data) {
    const w = Math.max(1, Math.min(5, q.weight ?? 1));
    for (let i = 0; i < w; i++) pool.push(q);
  }

  const picked = [];
  const seen = new Set();
  while (picked.length < n && pool.length) {
    const q = pool[Math.floor(Math.random() * pool.length)];
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    picked.push(q);
  }
  return picked;
}

async function createSession(sb, leagueId) {
  const { data, error } = await sb
    .from("sessions")
    .insert({ league_id: leagueId, status: "new", source: "manual", started_at: new Date().toISOString() })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function createPressConf(sb, sessionId, journalistId, channelId) {
  const { data, error } = await sb
    .from("press_conferences")
    .insert({ session_id: sessionId, journalist_id: journalistId, discord_channel_id: channelId })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function askQuestionAndCapture(channel, journalistName, questionText) {
  await channel.send(`**${journalistName}:** ${questionText}\n_(reply once; first reply counts)_`);

  const collected = await channel.awaitMessages({
    filter: (m) => !m.author.bot,
    max: 1,
    time: 120_000
  });

  const msg = collected.first();
  if (!msg) return null;
  return { discord_user_id: msg.author.id, answer: msg.content };
}

export async function execute(interaction, ctx) {
  const { sb, generateRecapFromPacket, publishToWorld } = ctx;

  await interaction.reply("🎙️ press conference starting…");

  const league = await getLeague(sb);
  const journalist = await getRandomJournalist(sb, league.id);
  const questions = await getQuestions(sb, league.id, 5);

  const session = await createSession(sb, league.id);
  const pc = await createPressConf(sb, session.id, journalist.id, interaction.channelId);

  const quotes = [];
  for (const q of questions) {
    const ans = await askQuestionAndCapture(interaction.channel, journalist.name, q.template);
    if (!ans) continue;

    await sb.from("press_answers").insert({
      press_conference_id: pc.id,
      press_question_id: q.id,
      discord_user_id: ans.discord_user_id,
      answer: ans.answer
    });

    quotes.push({ tag: q.tag, speaker_discord_id: ans.discord_user_id, text: ans.answer });
  }

  const packet = {
    league: { id: league.id, name: league.name },
    session: { id: session.id, started_at: session.started_at },
    match: {
      title_hint: "knowball matchday notes",
      our_score: null,
      opp_score: null,
      opponent_team_name: null
    },
    press: { journalist: { id: journalist.id, name: journalist.name, persona: journalist.persona }, quotes }
  };

  const { title, slug, md } = await generateRecapFromPacket(packet);

  const pub = await publishToWorld({
    date: todayISO(),
    slug,
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
    slug,
    status: "published",
    content_md: md,
    url: pub.url,
    published_at: new Date().toISOString()
  });

  await interaction.followUp(`📰 posted: ${pub.url}`);
}
