import { getOpenAI } from "./openai"

export async function generateSessionDossier({
    league,
    session,
    journalist,
    press_quotes = [],
    moments = [],
    matches = []
}) {
    const ai = getOpenAI();

    const MatchCount = {
        Total: matches.length,
        WithFinalScore: matches.filter(m => m?.score_confidence === 'final_board' && Number.isInteger(m?.our_goals) && Number.isInteger(m?.opp_goals)).length,
        WithAnyScore: matches.filter(m => m?.has_any_boxscore === true).length
    }

    const ctxObject = {
        league: { id: league?.id, name: league?.name },
        session: { id: session?.id, started_at: session?.started_at },
        journalist: journalist ? { id: journalist.id, name: journalist.name, persona: journalist.persona } : null,
        press_quotes,
        moments,
        matches,
        stats_coverage: { matchesTotal: MatchCount.Total, matchesFinal: MatchCount.WithFinalScore, matchesAny: MatchCount.WithAnyScore }
    }

    const res = await ai.responses.create({
        model: 'gpt-4o-mini',
        input: [
            { role: 'system', content: Prompt.WriteSessionDossier },
            { role: 'user', content: }
        ]
    })

}