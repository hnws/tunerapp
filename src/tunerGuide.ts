// Tuning guidance for the Tuner tab: which open string the player is on, how far off it is, and
// what to do about it in words a beginner (or a parent holding the violin) can follow -- tighten
// or loosen, fine tuner or peg, which way to turn, how much. Pure functions; the panel feeds them
// the smoothed live pitch.

import type { ViolinStringId } from "./appConfig";

export type { ViolinStringId };

export interface ViolinString {
  id: ViolinStringId;
  // Scientific pitch of the open string.
  note: string;
  // Semitones above A4; the string's frequency follows the reference A.
  semitonesFromA4: number;
}

// Lowest to highest, as on the instrument.
export const VIOLIN_STRINGS: readonly ViolinString[] = [
  { id: "G", note: "G3", semitonesFromA4: -14 },
  { id: "D", note: "D4", semitonesFromA4: -7 },
  { id: "A", note: "A4", semitonesFromA4: 0 },
  { id: "E", note: "E5", semitonesFromA4: 7 }
];

export const DEFAULT_REFERENCE_A_HZ = 440;

// Within this the string is left alone. The same +/-5 cents as the "Standard" grading band.
export const IN_TUNE_CENTS = 5;
// With no string chosen, a sound further than this from every open string isn't an open string
// being tuned (a fingered note is at least a semitone up). A string the player has picked is
// trusted much further out: a slipped peg can be a whole tone or more off, and that is exactly
// when the peg advice is needed.
export const WRONG_STRING_CENTS_AUTO = 150;
export const WRONG_STRING_CENTS_LOCKED = 350;
// Fine tuners move the pitch by roughly a semitone over their whole travel; past this the peg is
// the tool, then the fine tuner finishes the job.
export const FINE_TUNER_MAX_CENTS = 60;

export type TuningAmount = "hair" | "little" | "quite_a_bit" | "lot";
export type TuningTool = "fine_tuner" | "peg";

export interface TuningAdvice {
  string: ViolinString;
  targetHz: number;
  // Signed cents of the played pitch from the target string: negative = flat (too low).
  cents: number;
  verdict: "in_tune" | "flat" | "sharp" | "wrong_string";
  amount: TuningAmount | null;
  tool: TuningTool | null;
  // One line each, ready to show.
  heading: string;
  instruction: string;
}

export interface TuningOptions {
  referenceAHz?: number;
  // Strings fitted with a fine tuner (on the tailpiece). Others are tuned with the peg only.
  fineTuners?: readonly ViolinStringId[];
  // null = pick the string nearest to what's played.
  lockedString?: ViolinStringId | null;
  // The chromatic note name the detector heard (e.g. "C#5"), for the wrong-string message.
  heardNote?: string | null;
}

export function stringFrequencyHz(string: ViolinString, referenceAHz = DEFAULT_REFERENCE_A_HZ): number {
  return referenceAHz * Math.pow(2, string.semitonesFromA4 / 12);
}

export function centsBetween(playedHz: number, targetHz: number): number {
  return 1200 * Math.log2(playedHz / targetHz);
}

export function findString(id: ViolinStringId): ViolinString {
  return VIOLIN_STRINGS.find((string) => string.id === id)!;
}

export function nearestString(playedHz: number, referenceAHz = DEFAULT_REFERENCE_A_HZ): { string: ViolinString; cents: number } {
  let best = { string: VIOLIN_STRINGS[0], cents: centsBetween(playedHz, stringFrequencyHz(VIOLIN_STRINGS[0], referenceAHz)) };
  for (const string of VIOLIN_STRINGS.slice(1)) {
    const cents = centsBetween(playedHz, stringFrequencyHz(string, referenceAHz));
    if (Math.abs(cents) < Math.abs(best.cents)) {
      best = { string, cents };
    }
  }
  return best;
}

export function amountFor(cents: number): TuningAmount | null {
  const off = Math.abs(cents);
  if (off <= IN_TUNE_CENTS) return null;
  if (off <= 12) return "hair";
  if (off <= 30) return "little";
  if (off <= 80) return "quite_a_bit";
  return "lot";
}

const AMOUNT_WORDS: Record<TuningAmount, string> = {
  hair: "a hair",
  little: "a little",
  quite_a_bit: "quite a bit",
  lot: "a lot"
};

export function formatCentsOff(cents: number): string {
  const rounded = Math.round(Math.abs(cents));
  return `${rounded}¢ ${cents < 0 ? "flat" : "sharp"}`;
}

export function adviseTuning(playedHz: number, options: TuningOptions = {}): TuningAdvice {
  const referenceAHz = options.referenceAHz ?? DEFAULT_REFERENCE_A_HZ;
  const fineTuners = options.fineTuners ?? VIOLIN_STRINGS.map((string) => string.id);
  const locked = options.lockedString ? findString(options.lockedString) : null;
  const target = locked
    ? { string: locked, cents: centsBetween(playedHz, stringFrequencyHz(locked, referenceAHz)) }
    : nearestString(playedHz, referenceAHz);
  const { string, cents } = target;
  const targetHz = stringFrequencyHz(string, referenceAHz);
  const name = `${string.id} string`;

  if (Math.abs(cents) > (locked ? WRONG_STRING_CENTS_LOCKED : WRONG_STRING_CENTS_AUTO)) {
    const heard = options.heardNote ? `That sounds like ${options.heardNote}, ` : "That isn't an open string: ";
    return {
      string,
      targetHz,
      cents,
      verdict: "wrong_string",
      amount: null,
      tool: null,
      heading: locked ? `Not the ${name}` : "Not an open string",
      instruction: locked
        ? `${heard}not the open ${name}. Bow the ${name} on its own, with no finger down.`
        : `${heard}bow one open string on its own — G, D, A or E — with no finger down. If a peg has slipped, pick that string above and tune it anyway.`
    };
  }

  const amount = amountFor(cents);
  if (amount === null) {
    return {
      string,
      targetHz,
      cents,
      verdict: "in_tune",
      amount: null,
      tool: null,
      heading: `${name} is in tune`,
      instruction: `Leave it. ${nextStringHint(string)}`
    };
  }

  const flat = cents < 0;
  const hasFineTuner = fineTuners.includes(string.id);
  const tool: TuningTool = hasFineTuner && Math.abs(cents) <= FINE_TUNER_MAX_CENTS ? "fine_tuner" : "peg";
  const action = flat ? "Tighten" : "Loosen";
  const turn =
    tool === "fine_tuner"
      ? `turn the ${string.id} fine tuner ${flat ? "clockwise (to the right)" : "anticlockwise (to the left)"}`
      : `turn the ${string.id} peg ${flat ? "away from you, toward the scroll" : "toward you"}, pressing it in gently, while bowing`;
  const finish = tool === "peg" && hasFineTuner ? " Finish with the fine tuner once it's close." : "";
  return {
    string,
    targetHz,
    cents,
    verdict: flat ? "flat" : "sharp",
    amount,
    tool,
    heading: `${name} is ${formatCentsOff(cents)}`,
    instruction: `${action} ${AMOUNT_WORDS[amount]}: ${turn}.${finish}`
  };
}

function nextStringHint(string: ViolinString): string {
  const index = VIOLIN_STRINGS.indexOf(string);
  const next = VIOLIN_STRINGS[index + 1];
  return next ? `Next: the ${next.id} string.` : "All four done? Bow pairs of strings together to double-check.";
}
