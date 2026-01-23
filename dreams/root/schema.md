| table_name         | column_name                | data_type                | is_nullable |
| ------------------ | -------------------------- | ------------------------ | ----------- |
| articles           | id                         | uuid                     | NO          |
| articles           | league_id                  | uuid                     | NO          |
| articles           | season_id                  | uuid                     | YES         |
| articles           | session_id                 | uuid                     | YES         |
| articles           | journalist_id              | uuid                     | NO          |
| articles           | type                       | text                     | NO          |
| articles           | title                      | text                     | NO          |
| articles           | slug                       | text                     | NO          |
| articles           | status                     | text                     | NO          |
| articles           | content_md                 | text                     | NO          |
| articles           | url                        | text                     | YES         |
| articles           | published_at               | timestamp with time zone | YES         |
| articles           | meta                       | jsonb                    | NO          |
| articles           | created_at                 | timestamp with time zone | NO          |
| articles           | updated_at                 | timestamp with time zone | NO          |
| articles           | author                     | text                     | YES         |
| articles           | tags                       | ARRAY                    | YES         |
| articles           | press_conference_id        | uuid                     | YES         |
| articles           | dossier_id                 | uuid                     | YES         |
| journalists        | id                         | uuid                     | NO          |
| journalists        | league_id                  | uuid                     | NO          |
| journalists        | name                       | text                     | NO          |
| journalists        | slug                       | text                     | NO          |
| journalists        | persona                    | jsonb                    | NO          |
| journalists        | active                     | boolean                  | NO          |
| journalists        | created_at                 | timestamp with time zone | NO          |
| journalists        | updated_at                 | timestamp with time zone | NO          |
| leagues            | id                         | uuid                     | NO          |
| leagues            | name                       | text                     | NO          |
| leagues            | created_at                 | timestamp with time zone | NO          |
| match_player_stats | id                         | uuid                     | NO          |
| match_player_stats | match_id                   | uuid                     | NO          |
| match_player_stats | player_discord_user_id     | text                     | NO          |
| match_player_stats | goals                      | integer                  | YES         |
| match_player_stats | assists                    | integer                  | YES         |
| match_player_stats | passes                     | integer                  | YES         |
| match_player_stats | interceptions              | integer                  | YES         |
| match_player_stats | coverage                   | numeric                  | NO          |
| match_player_stats | source                     | text                     | NO          |
| match_player_stats | confidence                 | text                     | NO          |
| match_player_stats | notes                      | text                     | YES         |
| match_player_stats | created_at                 | timestamp with time zone | NO          |
| match_player_stats | updated_at                 | timestamp with time zone | NO          |
| matches            | id                         | uuid                     | NO          |
| matches            | league_id                  | uuid                     | NO          |
| matches            | session_id                 | uuid                     | NO          |
| matches            | video_id                   | uuid                     | YES         |
| matches            | match_index                | integer                  | YES         |
| matches            | our_goals                  | integer                  | YES         |
| matches            | opp_goals                  | integer                  | YES         |
| matches            | score_confidence           | text                     | NO          |
| matches            | score_coverage             | numeric                  | NO          |
| matches            | notes                      | text                     | YES         |
| matches            | created_at                 | timestamp with time zone | NO          |
| matches            | updated_at                 | timestamp with time zone | NO          |
| moments            | id                         | uuid                     | NO          |
| moments            | league_id                  | uuid                     | NO          |
| moments            | session_id                 | uuid                     | NO          |
| moments            | match_id                   | uuid                     | YES         |
| moments            | video_id                   | uuid                     | YES         |
| moments            | created_by_discord_user_id | text                     | YES         |
| moments            | source                     | text                     | NO          |
| moments            | confidence                 | text                     | NO          |
| moments            | t_s                        | numeric                  | YES         |
| moments            | window_pre_s               | integer                  | NO          |
| moments            | window_post_s              | integer                  | NO          |
| moments            | text                       | text                     | NO          |
| moments            | tags                       | ARRAY                    | NO          |
| moments            | created_at                 | timestamp with time zone | NO          |
| players            | id                         | uuid                     | NO          |
| players            | league_id                  | uuid                     | NO          |
| players            | discord_user_id            | text                     | NO          |
| players            | display_name               | text                     | NO          |
| players            | nicknames                  | ARRAY                    | NO          |
| players            | created_at                 | timestamp with time zone | NO          |
| players            | updated_at                 | timestamp with time zone | NO          |
| press_answers      | id                         | uuid                     | NO          |
| press_answers      | press_conference_id        | uuid                     | NO          |
| press_answers      | press_question_id          | uuid                     | NO          |
| press_answers      | discord_user_id            | text                     | NO          |
| press_answers      | answer                     | text                     | NO          |
| press_answers      | created_at                 | timestamp with time zone | NO          |
| press_conferences  | id                         | uuid                     | NO          |
| press_conferences  | session_id                 | uuid                     | NO          |
| press_conferences  | journalist_id              | uuid                     | NO          |
| press_conferences  | discord_channel_id         | text                     | YES         |
| press_conferences  | started_at                 | timestamp with time zone | NO          |
| press_conferences  | ended_at                   | timestamp with time zone | YES         |
| press_conferences  | created_at                 | timestamp with time zone | NO          |
| press_conferences  | updated_at                 | timestamp with time zone | NO          |
| press_questions    | id                         | uuid                     | NO          |
| press_questions    | league_id                  | uuid                     | NO          |
| press_questions    | tag                        | text                     | NO          |
| press_questions    | template                   | text                     | NO          |
| press_questions    | weight                     | integer                  | NO          |
| press_questions    | active                     | boolean                  | NO          |
| press_questions    | min_version                | text                     | YES         |
| press_questions    | created_at                 | timestamp with time zone | NO          |
| press_questions    | updated_at                 | timestamp with time zone | NO          |
| quotes             | id                         | uuid                     | NO          |