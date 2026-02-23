// === Core Types ===

export interface Vector2 {
  x: number; // Normalized pitch coords: 0.0 = left touchline, 1.0 = right touchline
  y: number; // 0.0 = our goal line, 1.0 = opponent goal line
}

export interface Vector2Velocity {
  dx: number; // Change in x per second (normalized units/sec)
  dy: number; // Change in y per second
}

export type Team = 'our_team' | 'opp_team';

export type PositionSource =
  | 'minimap_dot'       // Clearly visible on minimap
  | 'minimap_edge_arrow' // Direction-only from edge arrow
  | 'viewport'          // Detected in 3D viewport
  | 'interpolated'      // Filled in by tracking algorithm
  | 'extrapolated';     // Predicted from last known velocity + edge arrow

// === Player Actions ===

export type PlayerAction =
  | 'idle'
  | 'walking'           // Slow movement, not jogging
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

export interface PlayerState {
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

export type BallPhase =
  | 'possessed'    // A player has the ball
  | 'in_flight'    // Ball is airborne/moving toward a target
  | 'loose'        // No target, no carrier (free ball)
  | 'lost';        // Carrier was tackled, ball transitioning

export type BallTrajectorySource =
  | 'ground_pass'
  | 'lob_pass'
  | 'ground_shot'
  | 'aerial_shot'
  | 'tackle_dispossession'
  | 'deflection'
  | 'unknown';

export interface BallState {
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

export interface PriorityInteraction {
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

export type GamePhase =
  | 'gameplay'
  | 'goal_celebration'
  | 'kickoff'
  | 'loading'
  | 'replay'
  | 'halftime'
  | 'overtime'
  | 'unknown';

export interface HSVColor {
  h: number; // 0-360
  s: number; // 0-100
  v: number; // 0-100
}

export interface RGBColor {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

export interface GameState {
  timeRemaining: string;        // "03:41"
  timeRemainingSeconds: number; // 221
  scoreOurs: number;
  scoreOpponent: number;
  phase: GamePhase;
  phaseConfidence: number;

  // Team colors for this match
  ourTeamColor: HSVColor;
  oppTeamColor: HSVColor;
}

// === Minimap Detection (raw) ===

export interface MinimapMarker {
  position: Vector2;           // Position within minimap (0-1 normalized)
  color: HSVColor;
  shape: 'circle' | 'diamond' | 'arrow' | 'ball' | 'ball_target' | 'pov_arrow' | 'unknown';
  team: Team | null;           // Classified after color matching
  confidence: number;
  radiusPixels: number;        // Size in original pixels
}

export interface MinimapDetection {
  markers: MinimapMarker[];
  ballMarker: MinimapMarker | null;
  ballTargetMarker: MinimapMarker | null;
  povArrowAngle: number | null;  // Radians, facing direction
  minimapCenter: { x: number; y: number };  // Pixel coords in frame
  minimapRadius: number;         // Pixels
}

// === Frame State ===

export interface FrameState {
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

export interface MatchData {
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
  rosterScreen?: RosterScreenData;
  metadata: {
    mapName: string | null;
    matchDuration: number;
    recordingResolution: { width: number; height: number };
    sourceFile: string;
  };
}

// === Roster Screen ===

export interface RosterEntry {
  name: string;
  number: number | null;    // Jersey number (opponent only)
  confidence: number;       // OCR confidence
}

export interface RosterScreenData {
  ourTeam: RosterEntry[];
  oppTeam: RosterEntry[];
  frameUsed: string;        // Path to the frame that was OCR'd
}

// === Scorebug Extraction ===

export interface ScorebugData {
  timeRemaining: string;
  timeRemainingSeconds: number;
  scoreOurs: number;
  scoreOpponent: number;
  ourTeamColor: HSVColor;
  oppTeamColor: HSVColor;
  confidence: number;
}
