mvp to-do list
##phase 0 — repo + secrets
- create repo rematch-pressbox
- create .env with:
- - OPENAI_API_KEY
- - DISCORD_BOT_TOKEN
- - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or anon + rls)
- - GITHUB_TOKEN (if you publish by committing markdown)
- pick a “drop folder” where recordings land (~/RematchRecordings/)

##phase 1 — local session ingest
- node script watches folder
- on new mp4, create a `session` row in db an enqueue a job
- run ffmpeg to grab:
- - end-of-video frame(s) for scoreboard
- - optional highlight frames 

##phase 2 - read scoreboard
- run ocr on scoreboard frames
- parse into structured match packet
- store packet in db

##phase 3 - discord press conf bot
- 