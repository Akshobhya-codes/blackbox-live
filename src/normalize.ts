import {
  FIRST_MARKERS,
  HEARSAY_MARKERS,
  NEGATION_MARKERS,
  PROGRESSION_MARKERS,
  UNCERTAINTY_MARKERS,
  type LexEntry,
} from "./lexicon.ts";
import type { Certainty } from "./types.ts";

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Never render a full phone number on the dashboard. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  const last2 = digits.slice(-2);
  const cc = phone.trim().startsWith("+") ? `+${digits.slice(0, digits.length - 10) || "1"}` : "";
  return `${cc} (•••) •••-••${last2}`.trim();
}

export function toE164(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return "+" + trimmed.slice(1).replace(/\D/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function isPlausiblePhone(phone: string): boolean {
  return /^\+\d{10,15}$/.test(toE164(phone));
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

export interface Segment {
  /** Normalized (lowercased) text used for matching. */
  text: string;
  /** Original-cased text used for display excerpts. */
  raw: string;
  startsWithProgression: boolean;
  hasFirstMarker: boolean;
  /** Sequence position derived from narrative markers. */
  step: number;
}

function combinedRegex(patterns: RegExp[]): RegExp {
  // Longest alternatives first so "and then" wins over "then".
  const sources = patterns
    .map((p) => p.source)
    .sort((a, b) => b.length - a.length)
    .join("|");
  return new RegExp(`(?:${sources})`, "g");
}

const PROGRESSION_RE = combinedRegex(PROGRESSION_MARKERS);
const FIRST_RE = combinedRegex(FIRST_MARKERS);

/**
 * Splits an account into ordered clauses, cutting at narrative progression
 * markers ("and then", "a few seconds later") so we can infer event order
 * from how the witness actually told the story.
 */
export function splitIntoSegments(input: string): Segment[] {
  const raw = input.replace(/\s+/g, " ").trim();
  if (!raw) return [];

  const sentences = raw.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const segments: Segment[] = [];

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    PROGRESSION_RE.lastIndex = 0;
    const cuts: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = PROGRESSION_RE.exec(lower)) !== null) {
      if (m.index > 0) cuts.push(m.index);
      if (m.index === PROGRESSION_RE.lastIndex) PROGRESSION_RE.lastIndex++;
    }

    const bounds = [0, ...cuts, sentence.length];
    for (let i = 0; i < bounds.length - 1; i++) {
      const slice = sentence.slice(bounds[i], bounds[i + 1]).trim();
      if (!slice) continue;
      const sliceLower = slice.toLowerCase();
      FIRST_RE.lastIndex = 0;
      segments.push({
        text: normalizeText(slice),
        raw: slice.replace(/^[,;:\s]+/, "").trim(),
        startsWithProgression: i > 0 || startsWithMarker(sliceLower),
        hasFirstMarker: FIRST_RE.test(sliceLower),
        step: 0,
      });
    }
  }

  // Assign ordering steps. "first" pins a clause ahead of everything else.
  let step = 0;
  for (const seg of segments) {
    if (seg.hasFirstMarker) {
      seg.step = -1;
      continue;
    }
    if (seg.startsWithProgression) step += 1;
    seg.step = step;
  }
  return segments;
}

function startsWithMarker(sliceLower: string): boolean {
  PROGRESSION_RE.lastIndex = 0;
  const m = PROGRESSION_RE.exec(sliceLower);
  return m !== null && m.index <= 2;
}

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

export interface Mention {
  key: string;
  index: number;
  matched: string;
}

/** Finds every lexicon entry mentioned in a piece of text, with positions. */
export function findMentions(text: string, lex: LexEntry[]): Mention[] {
  const out: Mention[] = [];
  for (const entry of lex) {
    for (const pattern of entry.patterns) {
      const re = new RegExp(pattern.source, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        out.push({ key: entry.key, index: m.index, matched: m[0] });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }
  // Keep only the earliest mention per key so ordering comparisons are stable.
  const earliest = new Map<string, Mention>();
  for (const mention of out) {
    const prev = earliest.get(mention.key);
    if (!prev || mention.index < prev.index) earliest.set(mention.key, mention);
  }
  return [...earliest.values()].sort((a, b) => a.index - b.index);
}

export function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => new RegExp(p.source).test(text));
}

/** True when a negation cue appears before the mention within the same clause. */
export function isNegatedBefore(text: string, mentionIndex: number): boolean {
  const prefix = text.slice(0, mentionIndex);
  return matchesAny(prefix, NEGATION_MARKERS);
}

/**
 * Which of these mentions a negation actually applies to.
 *
 * A cue negates only the first event mention that follows it, and its reach
 * stops at a clause boundary. In "I did not hear a horn before the impact"
 * the horn is negated and the impact is not — the old rule negated both and
 * produced a witness who appeared to deny the collision itself.
 */
export function negatedMentions(text: string, mentions: Mention[]): Set<number> {
  const negated = new Set<number>();
  if (mentions.length === 0) return negated;

  for (const pattern of NEGATION_MARKERS) {
    const re = new RegExp(pattern.source, 'g');
    let cue: RegExpExecArray | null;
    while ((cue = re.exec(text)) !== null) {
      const start = cue.index + cue[0].length;
      const target = mentions
        .filter((m) => m.index >= start)
        .sort((a, b) => a.index - b.index)[0];
      if (!target) continue;
      // A subordinating boundary ends the negation's reach.
      const between = text.slice(start, target.index);
      if (/\b(before|after|when|while|then|but|because|though)\b|[,;]/.test(between)) continue;
      negated.add(target.index);
      if (cue.index === re.lastIndex) re.lastIndex++;
    }
  }
  return negated;
}

export function certaintyOf(text: string): Certainty {
  if (matchesAny(text, HEARSAY_MARKERS)) return "low";
  if (matchesAny(text, UNCERTAINTY_MARKERS)) return "medium";
  return "high";
}

export function isHearsay(text: string): boolean {
  return matchesAny(text, HEARSAY_MARKERS);
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * Parses a clock time into minutes since midnight.
 * `pmBias` pushes bare hours into the evening when the incident itself is at night.
 */
export function parseClockTime(text: string, pmBias = true): number | null {
  const t = normalizeText(text);

  let m = /\b(\d{1,2})\s*[:.]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)?/.exec(t);
  if (m) return assemble(Number(m[1]), Number(m[2]), m[3], pmBias);

  m = /\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)/.exec(t);
  if (m) return assemble(Number(m[1]), 0, m[2], pmBias);

  const words = Object.keys(WORD_NUMBERS).join("|");
  m = new RegExp(`\\b(${words})\\s+(\\d{1,2})\\b`).exec(t);
  if (m) return assemble(WORD_NUMBERS[m[1]], Number(m[2]), undefined, pmBias);

  return null;
}

function assemble(
  hour: number,
  minute: number,
  meridiem: string | undefined,
  pmBias: boolean,
): number | null {
  if (hour > 23 || minute > 59) return null;
  let h = hour;
  const mer = meridiem?.replace(/\./g, "").toLowerCase();
  if (mer === "pm" && h < 12) h += 12;
  else if (mer === "am" && h === 12) h = 0;
  else if (!mer && pmBias && h >= 1 && h <= 11) h += 12;
  return h * 60 + minute;
}

export function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const mer = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${mer}`;
}

/** Trims a clause down to a quotable excerpt for the provenance panel. */
export function excerpt(raw: string, maxLen = 180): string {
  const clean = raw.replace(/\s+/g, " ").trim().replace(/^[,;:.\s]+/, "");
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 1).trimEnd() + "…";
}
