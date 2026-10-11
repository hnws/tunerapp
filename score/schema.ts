export type SourceType = "musicxml" | "photo";

export interface ScoreNote {
  id: string;
  pitch: string;
  startBeat: number;
  durationBeats: number;
  fingering: number | null;
}

export interface ScoreMeasure {
  index: number;
  notes: ScoreNote[];
  // Present only when the time/key signature or tempo changes at this measure (or it's the first measure).
  timeSignature?: string;
  keySignature?: string;
  // null means no tempo was ever specified in the source, as opposed to a real authored value.
  tempoBpm?: number | null;
}

export interface ScoreAnnotation {
  id: string;
  kind: "text" | "markup";
  payload: Record<string, unknown>;
}

export interface PracticeHistoryEntry {
  id: string;
  startedAtIso: string;
  durationSeconds: number;
  summary: Record<string, unknown>;
}

// A bar whose notes don't add up to its time signature -- almost always a misread or missed note
// in an OMR (photo) import. Score following can stall on one, so the app warns before practice.
// measureNumber is 1-based by position in the part, the same numbering "Jump to bar" uses.
export interface ScoreMeasureIssue {
  measureNumber: number;
  kind: "empty" | "short" | "long";
  parsedQuarterNotes: number;
  expectedQuarterNotes: number;
}

export type TempoBeatUnit = "sixteenth" | "eighth" | "quarter" | "dottedQuarter";

export interface TempoMark {
  beatUnit: TempoBeatUnit;
  perMinute: number;
}

// Quarter notes per beat unit.
export const TEMPO_BEAT_UNIT_QUARTERS: Record<TempoBeatUnit, number> = {
  sixteenth: 0.25,
  eighth: 0.5,
  quarter: 1,
  dottedQuarter: 1.5
};

export interface ScoreDocument {
  title: string;
  composer: string;
  // null means no tempo was ever specified in the source, as opposed to a real authored value.
  // Always in quarter notes per minute.
  tempoBpm: number | null;
  // The printed metronome mark, when the source has one: its beat unit and the number per minute
  // (e.g. a sixteenth = 60 for an exercise practised one click per note). null when absent.
  tempoMark: TempoMark | null;
  keySignature: string;
  timeSignature: string;
  sourceType: SourceType;
  measures: ScoreMeasure[];
  annotations: ScoreAnnotation[];
  practiceHistory: PracticeHistoryEntry[];
  // Bars that don't fit their time signature (see ScoreMeasureIssue); absent when none.
  measureIssues?: ScoreMeasureIssue[];
}