// Runtime configuration: which features a deployment shows. Read from /config.json when the page
// loads (public/config.json is the default, built into dist/; a deployment can serve its own in its
// place without rebuilding), merged over DEFAULT_APP_CONFIG field by field, so a missing file or a
// missing/invalid field falls back to the default instead of breaking the page.

export type TrackingModeId = "matchmaker" | "metronome" | "listening";

export interface ScoreChoice {
  label: string;
  url: string;
}

export interface AppConfig {
  // Tracking modes offered on the Practice tab, in display order. "listening" (practice/cursor.ts's
  // ScoreFollower) is kept in the code but was never reliable live, so it's off by default.
  trackingModes: TrackingModeId[];
  // Selected on load; must be one of trackingModes (else the first of them is used).
  defaultTrackingMode: TrackingModeId;
  // MusicXML loaded on startup; "" starts empty. ?score=<url> and ?score=none still override it.
  defaultScore: string;
  // Scores offered in the "Score" dropdown of the Sheet music section (label + URL). The last one
  // chosen is remembered per browser and loaded instead of defaultScore on the next visit.
  scores: ScoreChoice[];
  // Keep each finished take (audio, alignment, per-note results) on the server so a session can be
  // checked afterwards (POST /api/takes/...; the server keeps the newest TAKES_KEEP).
  archiveTakes: boolean;
  // Developer controls: the "auto-correct time signatures" import option and the listening-mode
  // tuning toggles.
  showDevOptions: boolean;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  trackingModes: ["matchmaker", "metronome"],
  defaultTrackingMode: "matchmaker",
  defaultScore: "/scores/default.musicxml",
  scores: [],
  archiveTakes: false,
  showDevOptions: false
};

const TRACKING_MODE_IDS: readonly TrackingModeId[] = ["matchmaker", "metronome", "listening"];

function isTrackingMode(value: unknown): value is TrackingModeId {
  return typeof value === "string" && (TRACKING_MODE_IDS as readonly string[]).includes(value);
}

export function resolveAppConfig(raw: unknown): AppConfig {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const config: AppConfig = { ...DEFAULT_APP_CONFIG, trackingModes: [...DEFAULT_APP_CONFIG.trackingModes], scores: [] };

  if (Array.isArray(source.trackingModes)) {
    const modes = source.trackingModes.filter(isTrackingMode).filter((mode, index, all) => all.indexOf(mode) === index);
    if (modes.length > 0) {
      config.trackingModes = modes;
    }
  }
  if (isTrackingMode(source.defaultTrackingMode)) {
    config.defaultTrackingMode = source.defaultTrackingMode;
  }
  if (!config.trackingModes.includes(config.defaultTrackingMode)) {
    config.defaultTrackingMode = config.trackingModes[0];
  }
  if (typeof source.defaultScore === "string") {
    config.defaultScore = source.defaultScore;
  }
  if (Array.isArray(source.scores)) {
    config.scores = source.scores
      .filter((entry): entry is ScoreChoice => {
        const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
        return record !== null && typeof record.label === "string" && typeof record.url === "string" && record.url !== "";
      })
      .map((entry) => ({ label: entry.label, url: entry.url }));
  }
  if (typeof source.archiveTakes === "boolean") {
    config.archiveTakes = source.archiveTakes;
  }
  if (typeof source.showDevOptions === "boolean") {
    config.showDevOptions = source.showDevOptions;
  }
  return config;
}

export async function loadAppConfig(url = "/config.json"): Promise<AppConfig> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return resolveAppConfig(null);
    }
    return resolveAppConfig(await response.json());
  } catch (error) {
    console.warn("Couldn't read /config.json, using the built-in defaults", error);
    return resolveAppConfig(null);
  }
}
