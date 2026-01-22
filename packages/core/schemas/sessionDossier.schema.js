export const SessionDossierSchema = {
    name: "session_dossier",
    schema: {
        schema_version: 1,
        type: "object",
        additionalProperties: false,
        properties: {
            headline: { type: "string" },
            dek: { type: "string" },
            lede: { type: "string" },

            key_themes: {
            type: "array",
            items: { type: "string" }
            },

            notable_quotes: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                speaker_discord_user_id: { type: ["string", "null"] },
                speaker_name: { type: ["string", "null"] },
                tag: { type: ["string", "null"] },
                quote: { type: "string" }
                },
                required: ["speaker_discord_user_id", "speaker_name", "tag", "quote"]
            }
            },

            notable_moments: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                moment_id: { type: ["string", "null"] },
                match_index: { type: ["integer", "null"] },
                t_s: { type: ["number", "null"] },
                text: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                confidence: { type: "string" }
                },
                required: ["moment_id", "match_index", "t_s", "text", "tags", "confidence"]
            }
            },

            stats_coverage: {
            type: "object",
            additionalProperties: false,
            properties: {
                matches_total: { type: "integer" },
                matches_with_final_score: { type: "integer" },
                matches_with_any_boxscore: { type: "integer" }
            },
            required: ["matches_total", "matches_with_final_score", "matches_with_any_boxscore"]
            },

            open_questions: {
            type: "array",
            items: { type: "string" }
            },

            signature_moment_candidates: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                player_discord_user_id: { type: ["string", "null"] },
                title: { type: "string" },
                description: { type: ["string", "null"] },
                heat_delta: { type: "integer" }
                },
                required: ["player_discord_user_id", "title", "description", "heat_delta"]
            }
            }
        },
        required: [
            "headline",
            "dek",
            "lede",
            "key_themes",
            "notable_quotes",
            "notable_moments",
            "stats_coverage",
            "open_questions",
            "signature_moment_candidates",
            "schema_version"
        ]
    }
}