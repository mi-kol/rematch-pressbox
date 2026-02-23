/**
 * Resolution-dependent configuration for video parsing.
 * All pixel values are for 1920x1080 resolution.
 * Scale proportionally for other resolutions.
 */

export interface ResolutionConfig {
  width: number;
  height: number;

  // Scorebug region (top-left HUD)
  scorebug: {
    x: number;
    y: number;
    width: number;
    height: number;
    // Team color swatches within scorebug
    ourSwatchX: number;      // Left swatch (our team)
    ourSwatchWidth: number;
    oppSwatchX: number;      // Right swatch (opponent)
    oppSwatchWidth: number;
    swatchY: number;
    swatchHeight: number;
    // Timer region
    timerX: number;
    timerWidth: number;
    // Score digits region
    scoreX: number;
    scoreWidth: number;
  };

  // Minimap region (bottom-left)
  minimap: {
    centerX: number;
    centerY: number;
    radius: number;
  };

  // Boost meters (bottom-center, for POV player)
  boostMeters: {
    sprintX: number;
    sprintY: number;
    sprintWidth: number;
    sprintHeight: number;
    effortX: number;
    effortY: number;
    effortWidth: number;
    effortHeight: number;
  };
}

// 1920x1080 configuration
// Calibrated from sample footage analysis
export const CONFIG_1080P: ResolutionConfig = {
  width: 1920,
  height: 1080,

  scorebug: {
    // Full scorebug region - user calibrated: x(50,350), y(50,90)
    x: 50,
    y: 50,
    width: 300,
    height: 40,

    // Team color swatches
    // Our team swatch: x(170, 194), primary color at y(50, 60)
    ourSwatchX: 170,
    ourSwatchWidth: 24,
    // Opponent swatch: x(326, 350), primary color at y(50, 60)
    oppSwatchX: 326,
    oppSwatchWidth: 24,
    // Primary color is most prominent at y(50, 60)
    swatchY: 50,
    swatchHeight: 10,

    // Timer "MM:SS" on the far left
    timerX: 50,
    timerWidth: 60,

    // Score digits in the middle
    scoreX: 115,
    scoreWidth: 200,
  },

  minimap: {
    // Circular minimap in BOTTOM-RIGHT
    // Bounding box: x(1410-1900), y(570-1060) - includes space for edge arrows
    centerX: 1655,
    centerY: 815,
    radius: 245,
  },

  boostMeters: {
    // Sprint boost bar (bottom-center)
    sprintX: 850,
    sprintY: 1040,
    sprintWidth: 100,
    sprintHeight: 12,
    // Extra effort bar
    effortX: 970,
    effortY: 1040,
    effortWidth: 100,
    effortHeight: 12,
  },
};

/**
 * Get configuration scaled to a specific resolution.
 */
export function getConfigForResolution(width: number, height: number): ResolutionConfig {
  const scaleX = width / 1920;
  const scaleY = height / 1080;

  const base = CONFIG_1080P;

  return {
    width,
    height,

    scorebug: {
      x: Math.round(base.scorebug.x * scaleX),
      y: Math.round(base.scorebug.y * scaleY),
      width: Math.round(base.scorebug.width * scaleX),
      height: Math.round(base.scorebug.height * scaleY),
      ourSwatchX: Math.round(base.scorebug.ourSwatchX * scaleX),
      ourSwatchWidth: Math.round(base.scorebug.ourSwatchWidth * scaleX),
      oppSwatchX: Math.round(base.scorebug.oppSwatchX * scaleX),
      oppSwatchWidth: Math.round(base.scorebug.oppSwatchWidth * scaleX),
      swatchY: Math.round(base.scorebug.swatchY * scaleY),
      swatchHeight: Math.round(base.scorebug.swatchHeight * scaleY),
      timerX: Math.round(base.scorebug.timerX * scaleX),
      timerWidth: Math.round(base.scorebug.timerWidth * scaleX),
      scoreX: Math.round(base.scorebug.scoreX * scaleX),
      scoreWidth: Math.round(base.scorebug.scoreWidth * scaleX),
    },

    minimap: {
      centerX: Math.round(base.minimap.centerX * scaleX),
      centerY: Math.round(base.minimap.centerY * scaleY),
      radius: Math.round(base.minimap.radius * Math.min(scaleX, scaleY)),
    },

    boostMeters: {
      sprintX: Math.round(base.boostMeters.sprintX * scaleX),
      sprintY: Math.round(base.boostMeters.sprintY * scaleY),
      sprintWidth: Math.round(base.boostMeters.sprintWidth * scaleX),
      sprintHeight: Math.round(base.boostMeters.sprintHeight * scaleY),
      effortX: Math.round(base.boostMeters.effortX * scaleX),
      effortY: Math.round(base.boostMeters.effortY * scaleY),
      effortWidth: Math.round(base.boostMeters.effortWidth * scaleX),
      effortHeight: Math.round(base.boostMeters.effortHeight * scaleY),
    },
  };
}

// Processing settings
export const PROCESSING = {
  // Frame extraction
  defaultSampleFps: 5,        // Frames per second to extract for analysis
  keyframeSampleFps: 1,       // Lower rate for initial phase detection

  // Color matching thresholds
  colorMatchHueTolerance: 15,    // Degrees of hue difference to consider a match
  colorMatchSatTolerance: 30,    // Saturation tolerance (0-100)
  colorMatchValTolerance: 30,    // Value tolerance (0-100)

  // Tracking
  maxPlayerSpeed: 0.15,          // Max normalized units per second (scaled by dt in tracking)
  positionSmoothingFactor: 0.3,  // Kalman filter smoothing

  // Ball state machine
  looseballTimeout: 1.0,         // Seconds before in_flight -> loose
  possessionProximity: 0.02,     // Normalized distance for ball possession
};
