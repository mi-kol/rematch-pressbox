# Rematch Video Parser v2 — Revised Design

## Minimap Marker Reference (Corrected)

| Marker | Shape | Color | Meaning |
|--------|-------|-------|---------|
| **Circle** | Filled circle | Team primary color (from scorebug) | Teammate within minimap range |
| **Diamond** ◆ | Rotated square | Opponent primary color (from scorebug) | Opponent within minimap range |
| **Edge arrow** (teammate) | Triangular at circle edge | Our team's color | Teammate out of minimap range — direction only |
| **Edge arrow** (opponent) | Triangular at circle edge | Opponent's color | Opponent out of minimap range — direction only |
| **Ball** | White circle + yellow ring | White/Yellow | Ball position |
| **Ball target** | Yellow ring split into 4 segments | Yellow | Where ball will arrive / reception point |
| **POV player** | Directional arrow at center | White | You, pointing in facing direction |

### In-Viewport Indicators
| Indicator | Appearance | Meaning |
|-----------|-----------|---------|
| Light blue glowing circle on ground + small arrow/triangle | Blue glow | Ball's intended landing/reception point |
| Blue diamond (4 arrows) around ball | Blue | You are within contact range of the ball |
| Light blue outline glow at pass origin | Blue outline | Queued pass indicator |
| Diagonal upward arrow + flat ground line | Arrow shape | Lob pass trajectory |
| Flat line on ground toward destination | Ground line | Ground pass direction |
| Crosshair ( ) → full circle with dot | Crosshair anim | Charging shot; dot position = curve direction |

### Team Color Detection
- Scorebug layout: `[Time] [Our Swatch] [Our Score] [Opp Score] [Opp Swatch]`
- Our team swatch is ALWAYS the leftmost swatch
- Extract the dominant/primary color from each swatch
- Use those colors to classify minimap markers per-game (no hardcoding)

---

## Data Model (TypeScript)

```typescript
// === Core Types ===

interface Vector2 {
  x: number; // Normalized pitch coords: 0.0 = left touchline, 1.0 = right touchline
  y: number; // 0.0 = our goal line, 1.0 = opponent goal line
}

interface Vector2Velocity {
  dx: number; // Change in x per second (normalized units/sec)
  dy: number; // Change in y per second
}

type Team = 'our_team' | 'opp_team';

type PositionSource =
  | 'minimap_dot'       // Clearly visible on minimap
  | 'minimap_edge_arrow' // Direction-only from edge arrow
  | 'viewport'          // Detected in 3D viewport
  | 'interpolated'      // Filled in by tracking algorithm
  | 'extrapolated';     // Predicted from last known velocity + edge arrow

// === Player Actions ===

type PlayerAction =
  | 'idle'
  | 'running'
  | 'sprinting'         // Using boost/sprint
  | 'extra_effort'      // Using Extra Effort resource
  | 'passing'           // Ground pass
  | 'lob_passing'       // Aerial/lob pass
  | 'shooting'          // Ground shot
  | 'charging_shot'     // Crosshair charging animation
  | 'tackling'
  | 'being_tackled'
  | 'sliding'
  | 'jabbing'           // Less committal slide
  | 'diving'            // Outfield dive (non-directional leap)
  | 'rainbow_flick'
  | 'heading'           // Ball met at head height
  | 'receiving'         // Ball arriving, about to possess
  | 'one_touch_pass'    // Immediate pass on reception
  | 'one_touch_shot'    // Immediate shot on reception
  | 'queued_input'      // Has queued an action, waiting for ball
  | 'unknown';

// === Player State ===

interface PlayerState {
  playerId: string;              // Persistent tracking ID
  displayName: string | null;    // From nametag OCR when available
  team: Team;
  position: Vector2;
  velocity: Vector2Velocity;     // Current movement vector
  confidence: number;            // 0.0-1.0
  positionUncertainty: number;   // Radius of uncertainty (normalized coords)
  source: PositionSource;
  
  // Action state
  currentAction: PlayerAction;
  actionConfidence: number;      // How sure we are about the action
  hasBall: boolean;
  
  // Boost resources (only reliably known for POV player)
  sprintBoost: number | null;    // 0.0-1.0, null if unknown
  extraEffort: number | null;    // 0.0-1.0, null if unknown
  
  // Only known for POV player
  facingAngle: number | null;    // Radians
  isPovPlayer: boolean;
  
  // Input queue (when detectable)
  queuedAction: PlayerAction | null;
}

// === Ball State Machine ===

type BallPhase =
  | 'possessed'    // A player has the ball
  | 'in_flight'    // Ball is airborne/moving toward a target
  | 'loose'        // No target, no carrier (free ball)
  | 'lost';        // Carrier was tackled, ball transitioning

type BallTrajectorySource =
  | 'ground_pass'
  | 'lob_pass'
  | 'ground_shot'
  | 'aerial_shot'
  | 'tackle_dispossession'
  | 'deflection'
  | 'unknown';

interface BallState {
  position: Vector2;
  confidence: number;
  source: PositionSource;
  
  // State machine
  phase: BallPhase;
  previousPhase: BallPhase | null;
  phaseStartFrame: number;       // When current phase began
  
  // Movement
  movementDirection: Vector2Velocity;
  isAirborne: boolean;           // Lob pass or aerial shot
  trajectorySource: BallTrajectorySource;
  
  // Possession
  carrierId: string | null;      // playerId of ball holder
  previousCarrierId: string | null;
  
  // Target (when in_flight)
  targetPosition: Vector2 | null;  // Where ball will arrive
  targetConfidence: number;
}

// === Priority Interaction ===
// Records when multiple players contest for the ball

interface PriorityInteraction {
  frameNumber: number;
  timestamp: number;
  contestingPlayers: Array<{
    playerId: string;
    team: Team;
    queuedAction: PlayerAction;
    distanceToBall: number;
    won: boolean;              // Did this player win the priority?
  }>;
  ballPhaseAfter: BallPhase;
  outcome: string;             // Brief description
}

// === Game State ===

type GamePhase =
  | 'gameplay'
  | 'goal_celebration'
  | 'kickoff'
  | 'loading'
  | 'replay'
  | 'halftime'
  | 'overtime'
  | 'unknown';

interface GameState {
  timeRemaining: string;        // "03:41"
  timeRemainingSeconds: number; // 221
  scoreOurs: number;
  scoreOpponent: number;
  phase: GamePhase;
  phaseConfidence: number;
  
  // Team colors for this match
  ourTeamColor: { h: number; s: number; v: number }; // HSV from scorebug
  oppTeamColor: { h: number; s: number; v: number };
}

// === Frame State ===

interface FrameState {
  frameNumber: number;
  timestampSeconds: number;
  gameState: GameState;
  players: PlayerState[];       // Up to 10
  ball: BallState;
  povPlayerId: string;
  cameraHeading: number;        // Radians, minimap rotation
  
  // Debug/raw data
  minimapRaw: MinimapDetection | null;
}

// === Match Data (full output) ===

interface MatchData {
  frames: FrameState[];
  sourceFps: number;
  sampleFps: number;
  playerRoster: Record<string, {
    displayName: string;
    team: Team;
    firstSeen: number;         // Frame number
  }>;
  priorityInteractions: PriorityInteraction[];
  goals: Array<{
    frameNumber: number;
    scorerId: string | null;
    assisterId: string | null;
    team: Team;
    scoreAfter: { ours: number; opponent: number };
  }>;
  metadata: {
    mapName: string | null;
    matchDuration: number;
    recordingResolution: { width: number; height: number };
    sourceFile: string;
  };
}
```

---

## Architecture (Node.js)

### Technology Stack

```
Node.js 20+
├── @techstark/opencv-js (WASM) — or — sharp + custom CV logic
├── fluent-ffmpeg          — Frame extraction
├── tesseract.js           — OCR for timer/score/nametags
├── munkres-js             — Hungarian algorithm for tracking
├── Anthropic SDK          — Sparse LLM calls
└── TypeScript
```

**OpenCV options in Node:**
1. **opencv4nodejs-prebuilt** — Full native OpenCV bindings. Most capable but heavier install.
2. **@techstark/opencv-js** — OpenCV compiled to WASM. Runs in Node, no native deps. Slightly slower but zero install friction.
3. **sharp + manual pixel ops** — For simpler operations (crop, threshold, color space). Very fast, very lightweight. May be enough for minimap parsing since our operations are mostly: crop → color threshold → contour find.

**Recommendation**: Start with `sharp` for frame extraction/cropping and write the color thresholding manually on raw pixel buffers. It's fast, has zero native dependency headaches, and our operations are simple enough. If we need heavier CV later (Hough transforms for pitch lines, template matching), we add opencv-js.

### Pipeline Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    rematch-parser                        │
│                                                         │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌────────┐ │
│  │  Stage 1  │→│  Stage 2   │→│ Stage 3   │→│Stage 4  │ │
│  │  Extract  │  │  Detect    │  │  Track    │ │ Enrich │ │
│  │  & Class  │  │  Minimap   │  │  & Smooth │ │ (LLM)  │ │
│  └──────────┘  └───────────┘  └──────────┘  └────────┘ │
│       │              │              │             │      │
│       ▼              ▼              ▼             ▼      │
│   frames/        detections/    tracked/       match.json│
│   *.jpg          *.json         *.json                   │
└─────────────────────────────────────────────────────────┘
```

Each stage writes intermediate results to disk, so you can:
- Re-run individual stages without redoing everything
- Inspect intermediate results for debugging
- Resume if a stage crashes

### File Structure

```
rematch-parser/
├── package.json
├── tsconfig.json
├── src/
│   ├── types.ts              # All TypeScript interfaces above
│   ├── config.ts             # Resolution-dependent configs
│   ├── pipeline/
│   │   ├── extract.ts        # Stage 1: ffmpeg frame extraction + phase classification
│   │   ├── detect.ts         # Stage 2: Minimap + HUD parsing
│   │   ├── track.ts          # Stage 3: Frame-to-frame tracking + smoothing
│   │   └── enrich.ts         # Stage 4: Sparse LLM calls for events
│   ├── cv/
│   │   ├── minimap.ts        # Minimap isolation, marker detection
│   │   ├── scorebug.ts       # Score/timer/team-color extraction
│   │   ├── viewport.ts       # Nametag OCR, viewport analysis
│   │   └── colors.ts         # HSV operations on raw pixel buffers
│   ├── tracking/
│   │   ├── hungarian.ts      # Hungarian algorithm assignment
│   │   ├── kalman.ts         # Simple Kalman filter
│   │   └── identity.ts       # Player identity resolution
│   ├── ball/
│   │   └── stateMachine.ts   # Ball phase state machine
│   ├── viewer/
│   │   └── replay.html       # Top-down replay viewer (single HTML file)
│   └── index.ts              # CLI entry point
├── data/
│   └── pitches/              # Known pitch line layouts for each map
└── output/                   # Processing results
```

---

## Scorebug Color Extraction Algorithm

This is the critical first step for each match — determines how we classify everything else.

```
1. Grab first gameplay frame
2. Crop scorebug region (top-left, known pixel coordinates)
3. Locate the two color swatches:
   - Swatch 1 (left of scores) = Our team
   - Swatch 2 (right of scores) = Opponent team
4. For each swatch:
   - Convert to HSV
   - Find the dominant color cluster (largest area)
   - Store as team primary color
5. Use these colors throughout the match for minimap classification
```

This means our minimap detection becomes:
- "Is this blob closest to ourTeamColor?" → our player
- "Is this blob closest to oppTeamColor?" → opponent
- Shape confirmation: circles = our team, diamonds = opponents

---

## Ball State Machine (Expanded)

```
                ┌──────────────┐
                │   possessed  │←─────────────────┐
                └──────┬───────┘                   │
                       │ (pass/shot/lob detected)  │
                       ▼                           │
                ┌──────────────┐     carrier       │
           ┌───→│  in_flight   │───identified──────┘
           │    └──────┬───────┘                   │
           │           │ no target, no carrier >1s │
           │           ▼                           │
           │    ┌──────────────┐     carrier       │
           │    │    loose     │───identified──────┘
           │    └──────────────┘
           │           ▲
           │           │
           │    ┌──────────────┐
           └────│    lost      │  (carrier tackled)
                └──────────────┘
                       ▲
                       │
                ┌──────────────┐
                │   possessed  │──(tackled)────────→
                └──────────────┘

Transitions:
  possessed → in_flight    : Ball target ring appears on minimap/viewport
  possessed → lost         : Carrier tackled (tackle animation detected)
  in_flight → possessed    : New carrier identified (ball + player overlap)
  in_flight → loose        : No target visible, no carrier for >1s
  loose     → possessed    : Player contacts ball
  lost      → loose        : After brief transition period
  lost      → in_flight    : Ball deflects with trajectory
```

### One-Touch Detection

One-touch passes/shots are tricky because `in_flight → possessed → in_flight` happens almost instantly. Detection strategy:

1. When ball arrives at target position AND a player is there:
   - Check if pass/shot queue indicator was visible BEFORE ball arrival
   - Check if ball immediately changes direction (new in_flight within 3-5 frames)
   - If both: flag as one-touch
2. For POV player: check for the queued pass outline glow BEFORE ball reception
3. Record the `in_flight → possessed → in_flight` with `possessionDuration` in frames

---

## Priority Interaction Recording

When multiple players converge on the ball target:
1. Detect ball target ring position
2. Find all players within a threshold radius of that target
3. Record each player's queued action (if detectable) and distance
4. After resolution: record who won possession
5. Store as `PriorityInteraction` event

This builds a dataset over time that reveals:
- Which actions win priority over others
- Whether distance matters vs. action type
- Team-level priority win rates

---

## Open Items / Next Steps

1. **Build the scorebug color extractor** — this unlocks everything else
2. **Refine minimap marker detection** with shape analysis (circle vs diamond)
3. **Camera heading from minimap** — detect POV arrow orientation
4. **Pitch line matching** — map minimap to absolute pitch coordinates
5. **Frame-to-frame tracking** with Hungarian algorithm
6. **Top-down replay viewer** — HTML canvas rendering tracked positions
7. **Ball state machine implementation**
8. **One-touch detection logic**
9. **Sparse LLM enrichment** for ambiguous frames and event detection
