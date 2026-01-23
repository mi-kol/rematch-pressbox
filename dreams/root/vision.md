# Building an Automated Rematch Recap & Fictional Football News System

1. Game Data Capture & Extraction
Break the video-recorded gameplay into structured data. When a Rematch session ends (e.g. when your recording stops), automatically extract match results and stats. One approach is to use OCR (Optical Character Recognition) on end-game screens. For example, the app can programmatically grab the final scoreboard frame and use an OCR library (Tesseract via Python or a Node.js OCR package) to read scores, player names, and key stats. Finally, parse the OCR text into a structured format (e.g. JSON with fields like date, our team, opponent team, score, players, etc.), which will feed later steps.

2. Persistent League & Player Database
Maintain an internal data store to track the fictional league’s details and ensure consistency. This can be a simple JSON or a small database that catalogs fictional clubs, players, and match history. Each new player encountered should be assigned to a club in your fictional league (can automate an assignment or do it manually for realism). When a user notices certain opponents often play together on the same team, update the database to link those players as teammates in one club – this creates consistency (e.g. if players Alice and Bob frequently appear together, assign them to “FC Xyz” in your world). Track basic stats for each club (wins, losses against your team, any championship narrative) and for players (goals scored if available, notable performances). This historical data will let the AI-generated news reference ongoing storylines – for example, a rival club’s losing streak or a star player’s debut. Expect to occasionally refine this data by hand: e.g. merge duplicate entries if a player changes their username, or correct a club assignment if the pattern was wrong. Keeping this “fictional world” database updated is key to making the blog feel like a coherent sports universe.

3. Discord Bot for Post-Game Press Conferences
Develop a Discord bot (using a library like discord.js in Node.js, given your JavaScript comfort) that joins your group chat and conducts a brief Q&A after each session. The bot can be triggered automatically when a match ends (e.g. your system detects a new result) or via a command (like !pressconference). Once triggered, the bot posts a series of press-conference-style questions to the players. Prepare a list of generic but dynamic sports questions – for example: “When you were down 2 goals, how did the team stay positive?” or “What was the turning point of today’s match?” You can have the bot fill in specifics (like the goal difference or a player’s name) based on the match data. The bot should wait for each player’s answer in turn (or use threads/DMs to collect individual answers if that’s easier to manage). Use the Discord API to collect these responses (the quotes). This may involve the bot tagging each player with a question or using reactions to indicate whose turn it is. Keep the conversation flow natural – e.g. the bot asks, players answer, and maybe the bot asks one follow-up or thanks them at the end. These quotes will be saved (perhaps in the match JSON or a separate file) to be injected into the recap article.

4. AI-Generated Recap Article Creation
Leverage a language model (via an API like OpenAI or a local model) to generate a professional-sounding recap of the session’s games, incorporating the data and quotes. The content should read like a sports news article covering either a tournament run or a series of league games. Structure this generation step carefully:
- - Prompt Work: Feed the model a structured prompt including the match results, notable events, and the quotes from players' answers. Include any needed context from database, such as team names, league standings, or all-time H2H.
- - Tone and Style: Provide a few examples of sports journalism writing in the prompt or as fine-tuning. We want to generate a newspaper-style recap - factual but engaging, perhaps referencing the broader context. The model should ention key moments and integrate the quotes as if from a post-match interview.
- - Generation and Editing: Have the LLM generate an article draft. Review the output for weirdness. Aim to minimize manual editing via prompt refinement or second-pass AI moderation. Include relevant data explicitly, to counter hallucinations. Keep paragraphs short and crisp in the generated text.
- - Multi-Match Recaps: Some sessions have multiple matches, so we have to decide how to structure the recap. We could use a tournament framing - covering all the matches like a mini-tournamennt report (like "It's been a strong showing for The Goats as they emerge from the group stage with a 4-2 record." or even "A late heartbreaker in the knockouts has sent The Goats packing." after a session ends on a loss!)

5. Fictional News Feed Generation
The blog should feel like a real football sports news site. As such, we need to populate it with additional fictional football news from around the fictional league. We can automate a lot of this!
- - Create Templates: Outline common sports news storylines - transfer rumors, injury reports, power rankings, rivalry commentary, coach interviews, ex-pros, etc. For each time, have a template. 
- - Pull Data: Drive these stories using the fictional league database. Suppose one of the clubs has lost 3 games in a row - the AI could generate a news piece about the pressure mounting. If the players encounter a new standout opponent player, generate a Profile piece about the wunderkind.
- - Automate Creation: Schedule a script to generate a few news articles per week, or create some whenever recaps drop. Ensure consistency by having the script reference the database. 
- - Review: At first, review these auto-generated news bits for tone and consistency. Additionally, use AI and also manual spot checking to skim generated articles and ensure narrative consistency.

6. Automated Blogging
Set up blog infra that can receive content programmatically and publish it without manual steps. For now, we'll go with a SSG approach.
- - Use a SSG like Gatsby, Hugo, or Jekyll. We'll use GitHub Pages to deploy.
- - Ensure the articles are well-formamtted (Markdown, in our case). Can incorporate images for flair - for example, automatically generated screenshots fo score sheets.
- - Organize these articles and tag by category, set in post metadata. 
- - After a new article is written, it should publish automatically. The idea is: you play a session, and shortly afterwards a fully fleshed-out news article (plus other league news) magically appears.

7. Integration & Workflow Orchestration
This is a complex project with a bunch of moving parts.
### Pipeline Triggers
- Filesystem watcher of Medal recordings
- Custom hotkey or webhook
### Automation Sequence
1. Run OCR on Rematch clips
2. Parse match data
3. Update league database with new info
4. Notify Discord bot to perform press conference
5. Write article with data and quotes ready
6. Publish to blog
7. Inform subscribers
### Error handling
Project should have built-in checks and fallbacks, to make unintentional intervention rarely necessary. If scoreboard read fails, find a way to default to manual input or consult with Rematch Tracker. If the article is gibberish, log that and have a backup template to fill in as a basic report. 
### Maintenance
Some manual tasks are acceptable, but should not be necessary for anything but keeping the experience fresh.
1. Adding new press conference questions
2. Updating league data (existing players, and player associations)

