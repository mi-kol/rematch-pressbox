##core entities

players

id uuid pk
handle text unique (rematch name)
discord_user_id text nullable
first_seen timestamptz
last_seen timestamptz
is_friend boolean default false

clubs

id uuid pk
name text unique
slug text unique
colors jsonb (optional)
lore jsonb (optional)

player_club_membership

player_id uuid fk
club_id uuid fk
start_date date
end_date date nullable

##sessions + matches

sessions

id uuid pk
started_at timestamptz
ended_at timestamptz
video_path text (local path)
status text (new|processed|needs_review)
notes text

matches

id uuid pk
session_id uuid fk
ended_at timestamptz
our_score int
opp_score int
opponent_club_id uuid fk nullable
raw_ocr text
scoreboard_image_url text (r2 url)

match_participants

match_id uuid fk
player_id uuid fk
side text (us|them)
stats jsonb (goals/assists if you ever extract them)

##press conference

press_conferences

id uuid pk
session_id uuid fk
discord_channel_id text
started_at timestamptz
ended_at timestamptz

press_questions

id uuid pk
tag text (e.g. comeback, tilt, defense)
template text (can include placeholders like {scoreline})

press_answers

id uuid pk
press_conference_id uuid fk
press_question_id uuid fk
player_id uuid fk
answer text
created_at timestamptz

publishing

articles

id uuid pk
type text (recap|league_news|profile)
title text
slug text unique
content_md text
published_at timestamptz nullable
session_id uuid fk nullable
status text (draft|published|failed)
url text nullable