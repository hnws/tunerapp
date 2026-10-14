// The Tuner tab: tells the player which open string they're on, how far off it is and what to do
// about it (tighten/loosen, fine tuner or peg, which way, how much). Reads the live microphone
// state that App.tsx owns; the logic is in tunerGuide.ts. The upstream diagnostics (Hz,
// confidence, RMS, gain...) are kept in a closed "Signal details" fold.
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { LiveCaptureState } from "../audio/captureModule";
import type { TunerConfig } from "./appConfig";
import { statusLabel, statusPillStyle, statusStyles } from "./captureStatus";
import { SlButton, SlDetails, SlOption, SlRadioButton, SlRadioGroup, SlSelect, eventValue } from "./ui";
import {
  IN_TUNE_CENTS,
  VIOLIN_STRINGS,
  adviseTuning,
  findString,
  nearestString,
  stringFrequencyHz,
  type TuningAdvice,
  type ViolinStringId
} from "./tunerGuide";

// The reading shown is the median of the last few confident frames (a bow change or a wobble
// shouldn't flip the advice), and it stays up for a moment after the sound stops so the player
// can read it after lifting the bow.
const READING_WINDOW = 7;
const READING_MIN = 3;
const HOLD_AFTER_SILENCE_MS = 2500;
// The shown reading only moves when the median has moved this much: otherwise the text flickers
// between neighbouring values ("89¢" / "90¢", "a hair" / "a little") on a steady note.
const READING_DEAD_BAND_CENTS = 1.5;
// The meter shows this much either side of the target; readings beyond it sit at the edge.
const METER_RANGE_CENTS = 50;
const CLOSE_CENTS = 15;
const AUTO_STRING = "auto";

export interface TunerPanelProps {
  hidden: boolean;
  captureState: LiveCaptureState;
  isStarting: boolean;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  inputDevices: MediaDeviceInfo[];
  selectedDeviceId: string;
  systemDefaultDevice: string;
  onDeviceChange: (value: string) => void;
  config: TunerConfig;
}

export function TunerPanel(props: TunerPanelProps): ReactElement {
  const { captureState, config } = props;
  const [lockedString, setLockedString] = useState<ViolinStringId | null>(null);
  const [advice, setAdvice] = useState<TuningAdvice | null>(null);
  const [heardHz, setHeardHz] = useState<number | null>(null);
  const readingsRef = useRef<{ stringId: ViolinStringId | null; hz: number[] }>({ stringId: null, hz: [] });
  const holdTimerRef = useRef<number | null>(null);

  const listening = captureState.status === "listening";
  const hasPitch = listening && !captureState.isSilent && captureState.frequencyHz !== null;
  const frequencyHz = hasPitch ? captureState.frequencyHz : null;
  const heardNote = captureState.note;

  // A new string choice starts a fresh reading.
  useEffect(() => {
    readingsRef.current = { stringId: null, hz: [] };
    setAdvice(null);
    setHeardHz(null);
  }, [lockedString]);

  useEffect(() => {
    const readings = readingsRef.current;
    if (frequencyHz === null) {
      if (holdTimerRef.current === null && (advice !== null || readings.hz.length > 0)) {
        holdTimerRef.current = window.setTimeout(() => {
          holdTimerRef.current = null;
          readingsRef.current = { stringId: null, hz: [] };
          setAdvice(null);
          setHeardHz(null);
        }, HOLD_AFTER_SILENCE_MS);
      }
      return;
    }
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const stringId = lockedString ?? nearestString(frequencyHz, config.referenceAHz).string.id;
    if (readings.stringId !== stringId) {
      readings.stringId = stringId;
      readings.hz = [];
    }
    readings.hz.push(frequencyHz);
    if (readings.hz.length > READING_WINDOW) readings.hz.shift();
    if (readings.hz.length < READING_MIN) return;
    const sorted = [...readings.hz].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (advice && advice.string.id === stringId && heardHz !== null && Math.abs(1200 * Math.log2(median / heardHz)) < READING_DEAD_BAND_CENTS) {
      return;
    }
    setHeardHz(median);
    setAdvice(
      adviseTuning(median, {
        referenceAHz: config.referenceAHz,
        fineTuners: config.fineTuners,
        lockedString,
        heardNote
      })
    );
    // The advice depends on the latest frame only through frequencyHz/heardNote.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequencyHz, heardNote, lockedString, config]);

  useEffect(
    () => () => {
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    },
    []
  );

  const shownString = advice?.string ?? (lockedString ? findString(lockedString) : null);
  const meterCents = advice && advice.verdict !== "wrong_string" ? advice.cents : null;
  const tone: "idle" | "good" | "close" | "off" | "wrong" =
    advice === null ? "idle" : advice.verdict === "wrong_string" ? "wrong" : advice.verdict === "in_tune" ? "good" : Math.abs(advice.cents) <= CLOSE_CENTS ? "close" : "off";
  const toneColor = TONE_COLORS[tone];

  let heading: string;
  let instruction: string;
  if (advice) {
    heading = advice.heading;
    instruction = advice.instruction;
  } else if (!listening) {
    heading = captureState.status === "suspended" ? "Paused" : "Start the microphone";
    instruction =
      captureState.status === "suspended"
        ? "Press Resume and bow an open string."
        : captureState.status === "requesting" || captureState.status === "calibrating"
          ? "Getting the microphone ready…"
          : "Then bow one open string at a time. The tuner names the string and says which way to turn.";
  } else {
    heading = lockedString ? `Bow the open ${lockedString} string` : "Bow an open string";
    instruction = "A steady, medium-loud bow on one string with no finger down. Hold it until the reading settles.";
  }

  const levelRatio = captureState.silenceRmsThreshold > 0 ? Math.min(1, captureState.rms / captureState.silenceRmsThreshold) : 0;

  return (
    <section style={props.hidden ? { ...styles.card, display: "none" } : styles.card} aria-label="Tuner">
      <div style={styles.topRow}>
        <div>
          <p style={styles.kicker}>Live violin tuner</p>
          <h1 style={styles.title}>Tune the open strings</h1>
        </div>
        <span style={{ ...statusPillStyle, ...statusStyles[captureState.status] }}>{statusLabel(captureState.status)}</span>
      </div>

      <SlRadioGroup
        className="string-picker"
        label="String"
        name="tuner-string"
        value={lockedString ?? AUTO_STRING}
        onSlChange={(event) => {
          const value = eventValue(event);
          setLockedString(value === AUTO_STRING ? null : (value as ViolinStringId));
        }}
      >
        <SlRadioButton value={AUTO_STRING}>Auto</SlRadioButton>
        {VIOLIN_STRINGS.map((string) => (
          <SlRadioButton key={string.id} value={string.id}>
            {string.id}
          </SlRadioButton>
        ))}
      </SlRadioGroup>

      <div style={styles.readout} data-tone={tone}>
        <div style={styles.stringRow}>
          <div style={{ ...styles.stringName, color: toneColor }}>{shownString ? `${shownString.id} string` : "Open strings"}</div>
          <div style={styles.target}>
            {shownString ? `${shownString.note} · ${stringFrequencyHz(shownString, config.referenceAHz).toFixed(1)} Hz` : "G3 · D4 · A4 · E5"}
            {heardHz !== null ? ` · heard ${heardHz.toFixed(1)} Hz` : ""}
          </div>
        </div>

        <CentsMeter cents={meterCents} color={toneColor} />

        <div style={{ ...styles.heading, color: toneColor }} data-testid="tuner-heading">
          {heading}
        </div>
        <p style={styles.instruction} data-testid="tuner-instruction">
          {instruction}
        </p>
      </div>

      {captureState.error ? <div style={styles.errorBox}>{captureState.error.message}</div> : null}

      <div style={styles.buttonRow}>
        <SlButton variant="primary" size="medium" pill onClick={props.onStart} disabled={props.isStarting || captureState.status === "requesting" || listening}>
          {props.isStarting || captureState.status === "requesting"
            ? "Starting…"
            : captureState.status === "suspended"
              ? "Resume"
              : listening
                ? "Microphone on"
                : "Start microphone"}
        </SlButton>
        <SlButton size="medium" pill onClick={props.onPause} disabled={!listening}>
          Pause
        </SlButton>
        <SlButton size="medium" pill onClick={props.onStop} disabled={captureState.status === "idle"}>
          Stop
        </SlButton>
      </div>

      <SlDetails className="fold" summary="Microphone and signal details" style={{ marginTop: 12 }}>
        <SlSelect
          size="small"
          label="Microphone"
          value={props.selectedDeviceId || props.systemDefaultDevice}
          onSlChange={(event) => props.onDeviceChange(eventValue(event))}
          disabled={listening || captureState.status === "calibrating"}
        >
          <SlOption value={props.systemDefaultDevice}>System default</SlOption>
          {props.inputDevices.map((device, index) => (
            <SlOption key={device.deviceId || index} value={device.deviceId}>
              {device.label || `Microphone ${index + 1}`}
            </SlOption>
          ))}
        </SlSelect>
        <div style={styles.detailGrid}>
          <Detail label="Note" value={hasPitch ? captureState.note ?? "--" : "No note"} />
          <Detail label="Frequency" value={captureState.frequencyHz === null ? "--" : `${captureState.frequencyHz.toFixed(2)} Hz`} />
          <Detail label="Cents off nearest note" value={captureState.centsOff === null ? "--" : `${captureState.centsOff >= 0 ? "+" : ""}${captureState.centsOff.toFixed(1)}`} />
          <Detail label="Confidence" value={`${(captureState.confidence * 100).toFixed(0)}%`} />
          <Detail label="Live RMS" value={captureState.rms.toFixed(4)}>
            <div style={styles.meterTrack} aria-hidden="true">
              <div style={{ ...styles.meterFill, width: `${Math.max(6, levelRatio * 100)}%` }} />
            </div>
          </Detail>
          <Detail label="Silence threshold" value={captureState.silenceRmsThreshold.toFixed(4)} />
          <Detail label="Gain" value={`${captureState.gainScalar.toFixed(1)}x`} />
          <Detail label="Sample rate" value={captureState.sampleRate > 0 ? `${captureState.sampleRate} Hz` : "--"} />
          <Detail label="Frame / hop" value={`${captureState.frameSize} / ${captureState.hopSize}`} />
          <Detail label="Active microphone" value={captureState.activeDeviceLabel ?? "--"} />
          <Detail label="Reference A" value={`${config.referenceAHz} Hz`} />
          <Detail label="Fine tuners on" value={config.fineTuners.length > 0 ? config.fineTuners.join(" ") : "none"} />
        </div>
        <p style={styles.caption}>
          Echo cancellation, noise suppression and automatic gain control are off for violin. In tune means within ±{IN_TUNE_CENTS}¢ of the string at A = {config.referenceAHz} Hz.
        </p>
      </SlDetails>
    </section>
  );
}

function Detail(props: { label: string; value: string; children?: ReactNode }): ReactElement {
  return (
    <div style={styles.detailCard}>
      <div style={styles.detailLabel}>{props.label}</div>
      <div style={styles.detailValue}>{props.value}</div>
      {props.children}
    </div>
  );
}

// Horizontal meter: flat on the left, sharp on the right, green band in the middle.
function CentsMeter(props: { cents: number | null; color: string }): ReactElement {
  const clamped = props.cents === null ? 0 : Math.max(-METER_RANGE_CENTS, Math.min(METER_RANGE_CENTS, props.cents));
  const position = 50 + (clamped / METER_RANGE_CENTS) * 50;
  const inTuneWidth = (IN_TUNE_CENTS / METER_RANGE_CENTS) * 50;
  const closeWidth = (CLOSE_CENTS / METER_RANGE_CENTS) * 50;
  const ticks = [-50, -25, 0, 25, 50];
  return (
    <div style={styles.meter} role="img" aria-label={props.cents === null ? "No reading" : `${Math.round(props.cents)} cents`}>
      <div style={styles.meterScale}>
        <div style={{ ...styles.meterZone, left: `${50 - closeWidth}%`, width: `${closeWidth * 2}%`, background: "rgba(255, 193, 109, 0.22)" }} />
        <div style={{ ...styles.meterZone, left: `${50 - inTuneWidth}%`, width: `${inTuneWidth * 2}%`, background: "rgba(107, 232, 180, 0.35)" }} />
        {ticks.map((tick) => (
          <div key={tick} style={{ ...styles.meterTick, left: `${50 + (tick / METER_RANGE_CENTS) * 50}%`, height: tick === 0 ? "100%" : "40%" }} />
        ))}
        {props.cents !== null ? <div style={{ ...styles.meterNeedle, left: `${position}%`, background: props.color, boxShadow: `0 0 12px ${props.color}` }} /> : null}
      </div>
      <div style={styles.meterLabels}>
        <span>flat −50¢</span>
        <span style={{ color: props.cents === null ? "rgba(204, 214, 232, 0.7)" : props.color, fontWeight: 700, fontSize: 20 }}>
          {props.cents === null ? "—" : `${props.cents > 0 ? "+" : props.cents < 0 ? "−" : ""}${Math.abs(Math.round(props.cents))}¢`}
        </span>
        <span>+50¢ sharp</span>
      </div>
    </div>
  );
}

const TONE_COLORS = {
  idle: "rgba(204, 214, 232, 0.9)",
  good: "#6be8b4",
  close: "#ffc16d",
  off: "#ff7a7a",
  wrong: "#9aa0a6"
} as const;

const styles: Record<string, CSSProperties> = {
  card: {
    position: "relative",
    overflow: "hidden",
    borderRadius: "18px",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    background: "linear-gradient(180deg, rgba(12, 22, 37, 0.92), rgba(8, 14, 23, 0.96))",
    boxShadow: "0 30px 80px rgba(0, 0, 0, 0.38)",
    padding: "16px"
  },
  topRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "start",
    marginBottom: "12px"
  },
  kicker: {
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: "0.2em",
    fontSize: "12px",
    color: "rgba(204, 214, 232, 0.72)"
  },
  title: {
    margin: "8px 0 0",
    fontSize: "clamp(1.3rem, 2.5vw, 1.8rem)",
    lineHeight: 1,
    letterSpacing: "-0.03em"
  },
  readout: {
    marginTop: "12px",
    borderRadius: "14px",
    padding: "16px",
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.08)"
  },
  stringRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: "8px"
  },
  stringName: {
    fontSize: "clamp(2rem, 5vw, 3rem)",
    fontWeight: 800,
    letterSpacing: "-0.04em",
    lineHeight: 1
  },
  target: {
    color: "rgba(204, 214, 232, 0.7)",
    fontSize: "14px"
  },
  meter: {
    margin: "16px 0 12px"
  },
  meterScale: {
    position: "relative",
    height: "44px",
    borderRadius: "10px",
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    overflow: "hidden"
  },
  meterZone: {
    position: "absolute",
    top: 0,
    bottom: 0
  },
  meterTick: {
    position: "absolute",
    bottom: 0,
    width: "1px",
    background: "rgba(255, 255, 255, 0.35)",
    transform: "translateX(-0.5px)"
  },
  meterNeedle: {
    position: "absolute",
    top: "4px",
    bottom: "4px",
    width: "6px",
    borderRadius: "3px",
    transform: "translateX(-3px)",
    transition: "left 120ms linear"
  },
  meterLabels: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: "6px",
    fontSize: "12px",
    color: "rgba(204, 214, 232, 0.7)"
  },
  heading: {
    fontSize: "clamp(1.3rem, 3vw, 1.9rem)",
    fontWeight: 700,
    letterSpacing: "-0.03em",
    minHeight: "1.3em"
  },
  instruction: {
    margin: "8px 0 0",
    fontSize: "clamp(1rem, 2vw, 1.2rem)",
    lineHeight: 1.45,
    color: "rgba(245, 247, 251, 0.92)",
    minHeight: "2.9em"
  },
  errorBox: {
    marginTop: "12px",
    padding: "10px 12px",
    borderRadius: "12px",
    border: "1px solid rgba(255, 84, 84, 0.3)",
    background: "rgba(255, 84, 84, 0.12)",
    color: "#ffb3b3"
  },
  buttonRow: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    marginTop: "14px"
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: "8px",
    marginTop: "10px"
  },
  detailCard: {
    borderRadius: "10px",
    padding: "8px 10px",
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.08)"
  },
  detailLabel: {
    color: "rgba(204, 214, 232, 0.7)",
    fontSize: "11px",
    letterSpacing: "0.04em",
    textTransform: "uppercase"
  },
  detailValue: {
    fontSize: "14px",
    fontWeight: 600,
    marginTop: "2px"
  },
  meterTrack: {
    width: "100%",
    height: "6px",
    marginTop: "6px",
    borderRadius: "3px",
    background: "rgba(255, 255, 255, 0.08)",
    overflow: "hidden"
  },
  meterFill: {
    height: "100%",
    borderRadius: "3px",
    background: "linear-gradient(90deg, #6be8b4, #ffc16d)"
  },
  caption: {
    margin: "10px 0 0",
    fontSize: "12px",
    color: "rgba(204, 214, 232, 0.6)"
  }
};
