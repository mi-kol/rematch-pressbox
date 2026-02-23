# Session Notes — Persistent Context for Claude

## Current State (All Major Work Complete)

### 10-Iteration Plan — ALL COMPLETE
1. Background subtraction — cv/minimap-bg.ts
2. Pixel classification — cv/minimap-classify.ts, minimap.ts
3. Full pipeline wired — index.ts
4. Viewport nametag detection — cv/viewport.ts (text-first approach)
5. Viewport-minimap fusion — pipeline/fuse.ts
6. Tracking refinements — pipeline/track.ts (birth delay, re-id, merge, clamping)
7. Ball tracking — ball/stateMachine.ts
8. Action detection — velocity-based (idle/walking/running/sprinting)
9. Output enrichment — pipeline/enrich.ts (goals, interactions)
10. Testing & polish — 110 vitest tests passing

### Roster OCR — COMPLETE
- `cv/roster.ts`: detection (`isRosterScreen`) + OCR (`parseRosterScreen`)
- `tracking/identity.ts`: `setKnownNames()` + `fuzzyMatchRosterName()` (Levenshtein ≤2, substring)
- `index.ts`: Stage 0 scanning with best-of-all-frames
- E2E test: `tests/integration/test-e2e-roster.mjs`

### Data Quality Fixes (6-Phase Plan) — ALL COMPLETE
1. Score temporal filtering (scorebug.ts, enrich.ts) — 7-frame sliding window majority vote + monotonicity + increment-by-1
2. Tracking stability (track.ts) — Kalman velocity fix, velocity cap, boundary ghost pruning
3. Nametag cleanup (viewport.ts, identity.ts) — blocklist, confidence threshold
4. Roster team fix (index.ts) — cross-reference names after 50 frames, auto-swap
5. Ball state machine (stateMachine.ts) — carrier clearing after 3 frames, interpolated players excluded
6. Action recalibration (track.ts, types.ts) — added 'walking' tier, interpolated tracks get action='unknown'

## Roster Screen Detection & OCR

### `isRosterScreen()` — Two-Region Brightness Check
- OLD approach (broken): minimap variance check — always failed because 3D world visible behind overlay (variance 1000-1800)
- NEW approach: check HOME label brightness > 150 AND AWAY card1 brightness < 80
  - HOME label region: (255, 200, 85x50) at 1920x1080 — bright colored swatch on true roster
  - AWAY card1 region: (1440, 270, 240x60) — dark semi-transparent overlay on true roster
  - Perfect 5/5 separation across all test frames

### `parseRosterScreen()` — Targeted Card Extraction
- Layout (at 1920x1080, stored as ratios for resolution independence):
  - HOME cards: start (200, 270), each 240x60, 20px vertical gap, 5 cards
  - AWAY cards: start (1440, 270), same layout
  - HOME label: (255, 200) to (340, 250)
  - AWAY label: (1693, 200) to (1780, 250)
- Name extraction: top half of each card (30px at 1080p)
- OCR preprocessing: `grayscale().threshold(180).negate()` — isolates bright white name text from semi-transparent card background
- Post-processing: first word only (background artifacts appear as trailing low-confidence words)
- POV player matching: `nameMatchesPov()` fuzzy match to determine which side (HOME/AWAY) is ours
- Default POV name: `'y3lvin.'`
- Results (roster_01.png): Our team: Tweek, y3lvin., grace, Eric_Blake, TacticalBBQ; Opponents: ThePenitent1, pureofhrt, Cosmic-Pot-, Jhustn-, Monte052298

## Tracking System (Updated)
- Hungarian algorithm + Kalman filtering
- **Kalman velocity**: standard update `vx + kx * innovation / dt`, capped at MAX_VELOCITY=0.5
- **Variance capped**: MAX_VAR_V=0.05 prevents unbounded growth; reduced on observation
- **Birth delay**: BIRTH_MATCH_DIST=0.10 (was 0.06), 2 frames to confirm
- **Graveyard stores lastObservedPosition** (not interpolated drift position)
- **Boundary ghost pruning**: tracks near edge for 3+ unseen frames pruned immediately
- **Merge ID**: numeric comparison (was broken string comparison "P10" < "P9")
- **maxDistance scaled by dt**: `maxPlayerSpeed * dt * 2.0` (was raw 0.15)
- Timeout: 25 frames (5s), MAX_TRACKS_PER_TEAM=5

## Ball / Actions / Enrichment (Updated)
- Ball: carrier cleared after 3 frames without carrier; interpolated players excluded from carrier search
- Ball confidence decays 0.1/frame when undetected; possessed->lost only for tackles
- Actions: idle(<0.005) / walking(0.005-0.02) / running(0.02-0.06) / sprinting(>0.06)
- Interpolated tracks get action='unknown'
- Score: 7-frame sliding window majority vote + monotonicity + increment-by-1
- Goals: cooldown 15 frames after detection, require exactly +1 score change
- Singleton Tesseract workers for scorebug OCR (was creating/destroying per frame)

## Video Files
- `.claude/RematchFullGame.mp4` — full game (6 min, 900MB, 1080p@60fps) — primary test video
- `.claude/later.mp4` — short clip (~16s), used for initial testing only
- Sample frames in `.claude/frames-for-claude/` and `packages/parser/output/debug/`

## Team Colors (RematchFullGame.mp4)
- Our team: BRIGHT BLUE (H=197, S=94, V=58)
- Opponent: BRIGHT ORANGE (H=23, S=87, V=92)
- Scorebug swatches: our x(170-194), opp x(326-350), both y(50-60)

## File Key
- `cv/roster.ts` — roster screen detection + per-card OCR
- `cv/minimap-bg.ts` — background model (median) + subtraction
- `cv/minimap-classify.ts` — pixel classification + connected components
- `cv/minimap.ts` — parseMinimap entry point (uses classify)
- `cv/viewport.ts` — nametag detection (text-first approach)
- `cv/scorebug.ts` — team colors, score/time OCR, temporal filtering
- `cv/colors.ts` — color utilities (RGB->HSV, dominant color)
- `pipeline/track.ts` — Hungarian + Kalman tracking + birth delay + re-id + merge
- `pipeline/detect.ts` — per-frame detection orchestration
- `pipeline/fuse.ts` — viewport-minimap fusion (nametag->track binding)
- `pipeline/enrich.ts` — goal detection + priority interactions
- `tracking/identity.ts` — name voting + roster fuzzy matching
- `ball/stateMachine.ts` — ball phase state machine
- `index.ts` — full pipeline orchestration + CLI

## Common Pitfalls (Hard-Won Lessons)
- `findDominantColor()` skips s<40 — breaks gray team color detection
- Arrow needs BOTH edge position (>43%) AND elongation
- Ball hue 45-70 only (avoid green overlap)
- Background model needs WIDE temporal spread, not just detection window
- Circular mask essential for minimap extraction (5px inset)
- Nametag bg semi-transparent — use text-first detection, NOT team-color-first
- Birth delay: buffer new pendings separately to avoid same-frame false confirm
- Roster screen: minimap variance NOT usable for detection (3D field visible behind overlay)
- Roster OCR: threshold(180) for white text isolation; normalize() amplifies background noise
- Roster OCR: first word only — trailing words are always background artifacts
- Roster OCR threshold too high (>180) or too low (<140) both degrade quality; 180 is optimal for names
- protoDist() weights hue by min(a.s, b.s)/100 — grays have meaningless hue

## Known Issues / Future Work
- POV arrow detected only ~34% of frames
- Viewport indicators (shot charging, pass target) not implemented
- Full pipeline re-run on RematchFullGame.mp4 needed to measure all improvements end-to-end
- ID churn: ~26 unique tracks for 10 players over 20s (per-frame count is stable at 5+5)
