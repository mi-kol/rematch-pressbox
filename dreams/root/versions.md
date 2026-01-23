session 1:
- netlify publishes a post from _posts/
- supabase has basic tables + seed data (league, season, journalists, question bank)
- discord /pressconf latest asks questions, saves answers
- ai recap generator uses a fake match packet + real quotes
- publisher writes markdown + git commit/push + bot posts the URL

version 0.5:
goal: start grounding recaps in real sessions
- local collector notices a new mp4 and creates a session
- extracts 1–2 scoreboard frames (or end screen) and stores them
- ocr attempts to get at least the final score (with confidence + fallbacks)
- recap is now about a real session date + real score, still quote-driven
- publishing is fully automated (no manual post writing)

version 1:
goal: add match moments + high utility media.
- detect goal moments (goal overlay / end screen signature)
- generate auto goal clips around those timestamps
- recap includes a real “timeline” section (goal times) + links to clips
- system fails gracefully if detection misses (still publishes recap)

version 1.5:
goal: the journalist update
- journalists get depth
- - relationships per journalist <-> player
- - memory objects with callbacks to prior quotes, rivalries, collapses
- - rare journalist outreach via discord (asking for comments or opinions)
- opponent tracking
- - scoreboard OCR reads opponent handles
- - frequent opponent detection
- - discord alerts + commands to add/remove from canon
- matchday model
- - sessions are framed into matchdays / slates / series nights
- - pre-match "desk-note" when you get the morning heads up
- - post-match grading

beyond (the “newsroom sim” era)

- rumor mill generates storylines as structured case files
- journalist agents “investigate” by talking to npc sources (llm personas) and collecting evidence objects
- they escalate to asking real humans when verification is needed
- multi-journalist ecosystem (editor desk, feuds, corrections, credibility)
- selective clip-level commentary (“blunder/banger”) using only goal clips + spike clips
- voice press conferences (the dream): vc audio → transcript → quotes → recap