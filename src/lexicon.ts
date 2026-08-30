// Domain lexicon for incident reconstruction.
// Data-driven on purpose: adding a new incident domain means adding entries here,
// not editing the extraction logic.

export interface LexEntry {
  key: string;
  label: string;
  patterns: RegExp[];
  /** Noun phrase used when the key is dropped into a follow-up question. */
  noun?: string;
}

/** Physical things a witness can observe and describe. */
export const ENTITIES: LexEntry[] = [
  {
    key: "forklift",
    label: "Forklift",
    patterns: [/\bfork\s?lifts?\b/, /\blift\s?trucks?\b/, /\bpallet\s?jacks?\b/],
  },
  {
    key: "rack",
    label: "Storage rack",
    patterns: [/\bracks?\b/, /\bracking\b/, /\bshelves\b/, /\bshelving\b/, /\bshelf\b/],
  },
  { key: "alarm", label: "Alarm", patterns: [/\balarms?\b/, /\bsirens?\b/, /\bbuzzers?\b/] },
  { key: "truck", label: "Truck", patterns: [/\btrucks?\b/, /\btrailers?\b/] },
  { key: "car", label: "Car", patterns: [/\bcars?\b/, /\bsedans?\b/, /\bhatchbacks?\b/] },
  { key: "van", label: "Van", patterns: [/\bvans?\b/, /\bminivans?\b/] },
  {
    key: "motorcycle",
    label: "Motorcycle",
    patterns: [/\bmotor\s?cycles?\b/, /\bmotor\s?bikes?\b/, /\bscooters?\b/],
  },
  {
    key: "traffic_light",
    label: "Traffic signal",
    // \blight\b does not match "lighting", so this stays clear of our own
    // follow-up question about lighting conditions.
    patterns: [/\btraffic lights?\b/, /\bsignals?\b/, /\blights?\b/],
  },
  { key: "pallet", label: "Pallet", patterns: [/\bpallets?\b/] },
  { key: "person", label: "Person", patterns: [/\bworkers?\b/, /\boperators?\b/, /\bdrivers?\b/] },
  { key: "door", label: "Door", patterns: [/\bdoors?\b/, /\bgates?\b/] },
];

/**
 * Events that can be placed on a timeline. Order matters only for readability;
 * actual ordering is derived from what witnesses say.
 */
export const EVENTS: LexEntry[] = [
  {
    key: "collision",
    // Kept domain-neutral: this event fires for a forklift, a car, or a train.
    label: "Impact / collision",
    noun: "the collision",
    patterns: [
      /\bcollid\w*/,
      /\bcrash\w*/,
      /\bimpact\w*/,
      /\bstruck\b/,
      /\bstrikes?\b/,
      /\bhit\b/,
      /\bran into\b/,
      /\bbacked into\b/,
      /\breversed? into\b/,
      /\breversing into\b/,
      /\bbumped\b/,
    ],
  },
  {
    key: "rack_collapse",
    label: "Storage rack collapses",
    noun: "the rack collapsing",
    patterns: [
      /\bcollaps\w*/,
      /\bfell\b/,
      /\bfalling\b/,
      /\bfall\b/,
      /\btoppl\w*/,
      /\bcame down\b/,
      /\bcame crashing\b/,
      /\bgave way\b/,
    ],
  },
  {
    key: "alarm",
    label: "Alarm sounds",
    noun: "the alarm",
    patterns: [
      /\balarms?\b/,
      /\bsirens?\b/,
      /\bwent off\b/,
      /\bgoing off\b/,
      /\bsounded\b/,
      /\bbuzzers?\b/,
    ],
  },
  {
    key: "chemical_smell",
    label: "Chemical smell detected",
    noun: "a chemical smell",
    patterns: [/\bsmell(?:s|ed|ing)?\b/, /\bodou?rs?\b/, /\bfumes?\b/, /\bstench\b/],
  },
  {
    key: "smoke",
    label: "Smoke observed",
    noun: "smoke",
    patterns: [/\bsmoke\b/, /\bsmok(?:y|ing)\b/],
  },
  {
    key: "fire",
    label: "Fire observed",
    noun: "a fire",
    patterns: [/\bfires?\b/, /\bflames?\b/, /\bburning\b/],
  },
  {
    key: "spill",
    label: "Spill or leak",
    noun: "a spill or leak",
    patterns: [/\bspill(?:s|ed|ing)?\b/, /\bleak(?:s|ed|ing)?\b/, /\bpuddles?\b/],
  },
  {
    key: "shouting",
    label: "Shouting or verbal warning",
    noun: "shouting or a verbal warning",
    // Suffixes are enumerated, not open-ended: /\byell\w*/ also matched "yellow".
    patterns: [
      /\bshout(?:s|ed|ing)?\b/,
      /\byell(?:s|ed|ing)?\b/,
      /\bscream(?:s|ed|ing)?\b/,
      /\bcalled out\b/,
    ],
  },
  {
    key: "evacuation",
    label: "Area evacuated",
    noun: "an evacuation",
    patterns: [/\bevacuat(?:e|ed|ing|ion)?\b/, /\bcleared the area\b/],
  },
  {
    key: "horn",
    label: "Horn sounded",
    noun: "the horn",
    patterns: [/\bhorns?\b/, /\bhonk(?:s|ed|ing)?\b/, /\bbeep(?:s|ed|ing)?\b/],
  },
  {
    key: "braking",
    label: "Braking or skidding",
    noun: "braking or skidding",
    patterns: [
      /\bbrak(?:e|es|ed|ing)\b/,
      /\bskid(?:s|ded|ding)?\b/,
      /\bscreech(?:es|ed|ing)?\b/,
      /\btyres? squeal/,
      /\btires? squeal/,
    ],
  },
  {
    key: "steam",
    label: "Steam or vapour",
    noun: "steam or vapour",
    patterns: [/\bsteam(?:ing)?\b/, /\bvapou?rs?\b/],
  },
  {
    key: "pedestrian_present",
    label: "Person on foot in the crossing",
    noun: "anyone on foot in or near the crossing",
    patterns: [/\bpedestrians?\b/, /\bcross\s?walk\b/, /\bon foot\b/, /\bzebra crossing\b/],
  },
  {
    key: "airbag",
    label: "Airbag deployed",
    noun: "an airbag deploying",
    patterns: [/\bair\s?bags?\b/],
  },
];

/** Attributes that are mutually exclusive — two different values is a real conflict. */
export const EXCLUSIVE_PREDICATES = new Set(["color", "direction", "count", "place_id"]);

export const COLORS = [
  "blue",
  "yellow",
  "red",
  "green",
  "orange",
  "white",
  "black",
  "grey",
  "gray",
  "silver",
  "brown",
  "purple",
];

/** Normalizes spelling variants so "gray" and "grey" do not read as a contradiction. */
export const COLOR_ALIASES: Record<string, string> = { gray: "grey" };

export const DIRECTIONS = [
  "forward",
  "forwards",
  "backward",
  "backwards",
  "reverse",
  "reversing",
  "left",
  "right",
  "north",
  "south",
  "east",
  "west",
];

export const DIRECTION_ALIASES: Record<string, string> = {
  forwards: "forward",
  backwards: "backward",
  reversing: "reverse",
  reverse: "backward",
};

/** Phrases that advance the narrative to a later step. */
export const PROGRESSION_MARKERS = [
  /\band then\b/,
  /\bthen\b/,
  /\bnext\b/,
  /\bafter that\b/,
  /\bafterwards?\b/,
  /\bsubsequently\b/,
  /\ba few seconds later\b/,
  /\bseconds later\b/,
  /\bmoments later\b/,
  /\bshortly after\b/,
  /\bsoon after\b/,
  /\blater\b/,
  /\bfollowing that\b/,
  /\bat that point\b/,
  /\bright after\b/,
  /\bonce\b/,
];

/** Phrases that pin something to the beginning of the account. */
export const FIRST_MARKERS = [
  /\bfirst\b/,
  /\binitially\b/,
  /\bto begin with\b/,
  /\bat first\b/,
  /\bstarted with\b/,
  /\bbefore anything\b/,
];

/** Negation cues used to turn "I saw smoke" into an explicit absence claim. */
export const NEGATION_MARKERS = [
  /\bdid ?n[o']t\b/,
  /\bdidnt\b/,
  /\bno\b/,
  /\bnot\b/,
  /\bnever\b/,
  /\bnone\b/,
  /\bwithout\b/,
  /\bcould ?n[o']t\b/,
  /\bnothing\b/,
];

/** Hedges that lower a claim's certainty. */
export const UNCERTAINTY_MARKERS = [
  /\bi think\b/,
  /\bi believe\b/,
  /\bmaybe\b/,
  /\bprobably\b/,
  /\bpossibly\b/,
  /\bapproximately\b/,
  /\baround\b/,
  /\babout\b/,
  /\broughly\b/,
  /\bnot sure\b/,
  /\bnot certain\b/,
  /\bi guess\b/,
  /\bseemed\b/,
  /\blooked like\b/,
  /\blooked\b/,
  /\bsomething like\b/,
  /\bor so\b/,
  /\bto me\b/,
];

/** Hearsay cues — separates what a witness saw from what they were told. */
export const HEARSAY_MARKERS = [
  /\bsomeone (?:said|told)\b/,
  /\bi heard that\b/,
  /\bthey said\b/,
  /\bi was told\b/,
  /\bapparently\b/,
  /\bsecond ?hand\b/,
];

/**
 * Places are matched as a base type plus an optional identifier, so that
 * "near the loading dock" and "Loading Dock B" corroborate each other on the
 * base place while still exposing "Dock A" vs "Dock B" as a real conflict.
 * The identifier is a single letter or a short number — never a stray word.
 */
export interface PlacePattern {
  key: string;
  label: string;
  re: RegExp;
  /** Base keys this pattern outranks, so "loading dock" never also emits "dock". */
  supersedes?: string[];
}

export const PLACE_PATTERNS: PlacePattern[] = [
  {
    key: "loading_dock",
    label: "Loading dock",
    re: /\bloading dock(?:\s+([a-z]|\d{1,3})\b)?/,
    supersedes: ["dock"],
  },
  { key: "dock", label: "Dock", re: /\bdock(?:\s+([a-z]|\d{1,3})\b)?/ },
  { key: "warehouse", label: "Warehouse", re: /\bwarehouse(?:\s+([a-z]|\d{1,3})\b)?/ },
  { key: "aisle", label: "Aisle", re: /\baisle(?:\s+([a-z]|\d{1,3})\b)?/ },
  { key: "bay", label: "Bay", re: /\bbay(?:\s+([a-z]|\d{1,3})\b)?/ },
  { key: "gate", label: "Gate", re: /\bgate(?:\s+([a-z]|\d{1,3})\b)?/ },
  { key: "intersection", label: "Intersection", re: /\bintersection(?:\s+([a-z]|\d{1,3})\b)?/ },
  { key: "crossing", label: "Crossing", re: /\bcross\s?walk|\bzebra crossing/ },
  { key: "platform", label: "Platform", re: /\bplatform(?:\s+([a-z]|\d{1,3})\b)?/ },
];

export function entityLabel(key: string): string {
  return (
    ENTITIES.find((e) => e.key === key)?.label ??
    EVENTS.find((e) => e.key === key)?.label ??
    key.replace(/_/g, " ")
  );
}

export function eventLabel(key: string): string {
  return EVENTS.find((e) => e.key === key)?.label ?? key.replace(/_/g, " ");
}

/** Noun phrase for use inside a generated question. */
export function eventNoun(key: string): string {
  const entry = EVENTS.find((e) => e.key === key);
  if (entry?.noun) return entry.noun;
  return (entry?.label ?? key.replace(/_/g, " ")).toLowerCase();
}

export function placeLabel(key: string): string {
  return PLACE_PATTERNS.find((p) => p.key === key)?.label ?? key.replace(/_/g, " ");
}
