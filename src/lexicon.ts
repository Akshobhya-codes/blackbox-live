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
  // Named makes are separate entities, otherwise "black Tesla" and "white Honda"
  // both collapse to `car` and read as a colour contradiction about one vehicle.
  { key: "tesla", label: "Tesla", patterns: [/\bteslas?\b/] },
  { key: "honda", label: "Honda", patterns: [/\bhondas?\b/] },
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
      /\bbuzzers?\b/,
      /\bklaxons?\b/,
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
  {
    key: "vehicle_approach",
    label: "Vehicle approaches",
    noun: "the vehicle approaching",
    patterns: [/\bapproach(?:es|ed|ing)?\b/, /\bcoming (?:up|down|along|toward)\b/, /\bcame (?:up|down|along)\b/, /\bheading (?:north|south|east|west|toward)/, /\bdriving (?:north|south|east|west|toward)/],
  },
  {
    key: "entered_intersection",
    label: "Vehicle enters the intersection",
    noun: "entering the intersection",
    patterns: [/\benter(?:s|ed|ing)? the intersection\b/, /\binto the intersection\b/, /\bthrough the intersection\b/, /\bcross(?:ed|ing)? the intersection\b/, /\bpulled out\b/],
  },
  {
    key: "signal_change",
    label: "Traffic signal changes",
    noun: "the signal changing",
    patterns: [/\blight chang(?:e|ed|ing)\b/, /\bsignal chang(?:e|ed|ing)\b/, /\bchang(?:e|ed|ing) to (?:red|green|amber|yellow)\b/, /\bturn(?:s|ed|ing)? (?:red|green|amber|yellow)\b/, /\bwent (?:red|green|amber)\b/],
  },
  {
    key: "swerve",
    label: "Vehicle swerves",
    noun: "a swerve",
    patterns: [/\bswerv(?:e|es|ed|ing)\b/, /\bveer(?:s|ed|ing)?\b/, /\bcut across\b/],
  },
  {
    key: "acceleration",
    label: "Vehicle accelerates",
    noun: "the vehicle accelerating",
    patterns: [/\baccelerat(?:e|es|ed|ing)\b/, /\bsped up\b/, /\bspeeding up\b/, /\bgunned it\b/],
  },
  {
    key: "spin",
    label: "Vehicle spins or is pushed round",
    noun: "the vehicle spinning",
    patterns: [/\bspun\b/, /\bspin(?:s|ning)?\b/, /\brotat(?:e|ed|ing)\b/, /\bpushed (?:round|around|sideways)\b/],
  },
  {
    key: "came_to_rest",
    label: "Vehicles come to rest",
    noun: "the vehicles coming to rest",
    patterns: [/\bcame to (?:a )?(?:rest|stop|halt)\b/, /\bended up\b/, /\bcame to standstill\b/],
  },
  {
    key: "debris",
    label: "Debris or broken glass",
    noun: "debris or broken glass",
    patterns: [/\bdebris\b/, /\bbroken glass\b/, /\bglass (?:everywhere|on the road|shattered)\b/, /\bbumper (?:came off|fell)\b/],
  },
  {
    key: "exited_vehicle",
    label: "Someone gets out of a vehicle",
    noun: "someone getting out of a vehicle",
    patterns: [/\bgot out\b/, /\bclimbed out\b/, /\bstepped out\b/, /\bget(?:ting)? out of the (?:car|vehicle)\b/],
  },
  {
    key: "injury_observed",
    label: "Someone appears injured",
    noun: "anyone appearing injured",
    patterns: [/\binjur(?:y|ed|ies)\b/, /\bbleeding\b/, /\bunconscious\b/, /\bholding (?:his|her|their) (?:neck|head|arm)\b/, /\blimping\b/],
  },
  {
    key: "emergency_services",
    label: "Emergency services arrive",
    noun: "police or an ambulance arriving",
    patterns: [/\bpolice\b/, /\bambulance\b/, /\bparamedics?\b/, /\bfire (?:truck|engine|crew)\b/, /\bfirst responders?\b/],
  },
  {
    key: "called_emergency",
    label: "Emergency call placed",
    noun: "someone calling for help",
    patterns: [/\bcalled 911\b/, /\bcall(?:ed|ing)? (?:the )?(?:police|an ambulance|for help)\b/, /\bdialled 911\b/],
  },
  {
    key: "bystanders",
    label: "Bystanders gather",
    noun: "people gathering at the scene",
    patterns: [/\bbystanders?\b/, /\bcrowd\b/, /\bpeople (?:gathered|ran over|came over)\b/, /\bonlookers?\b/],
  },
];


/**
 * Where each event normally falls in an incident, lowest first.
 *
 * Used only to order events nobody sequenced explicitly. Anything a witness
 * actually ordered wins over this, and a contested ordering is still shown
 * as disputed wherever the event lands.
 */
export const EVENT_PHASE: Record<string, number> = {
  vehicle_approach: 10,
  signal_change: 15,
  entered_intersection: 20,
  acceleration: 25,
  swerve: 30,
  braking: 35,
  horn: 40,
  shouting: 42,
  collision: 50,
  rack_collapse: 52,
  alarm: 55,
  spin: 58,
  came_to_rest: 60,
  airbag: 62,
  debris: 65,
  smoke: 66,
  fire: 67,
  steam: 68,
  spill: 69,
  chemical_smell: 70,
  exited_vehicle: 72,
  injury_observed: 75,
  pedestrian_present: 76,
  called_emergency: 80,
  bystanders: 85,
  emergency_services: 90,
  evacuation: 95,
};

export function eventPhase(key: string): number {
  return EVENT_PHASE[key] ?? 50;
}

/**
 * How much answering this would move the case forward, 0-3.
 *
 * Governs which gaps become questions for a live caller. A witness will sit
 * through three or four questions, so they must be the ones that bear on
 * right of way, sequence, or causation — not details a vehicle report or a
 * scene photograph already settles.
 */
export const EVENT_MATERIALITY: Record<string, number> = {
  signal_change: 3,
  entered_intersection: 3,
  acceleration: 3,
  braking: 3,
  swerve: 3,
  horn: 3,
  pedestrian_present: 3,
  collision: 2,
  vehicle_approach: 2,
  injury_observed: 2,
  shouting: 2,
  alarm: 2,
  rack_collapse: 2,
  smoke: 2,
  fire: 2,
  spill: 2,
  chemical_smell: 2,
  spin: 1,
  came_to_rest: 1,
  debris: 1,
  called_emergency: 1,
  bystanders: 1,
  steam: 1,
  evacuation: 1,
  airbag: 0,
  exited_vehicle: 0,
  emergency_services: 0,
};

/** Conditions are always material: they bear on braking and visibility,
 *  and unlike most testimony an independent record can settle them. */
export const ATTRIBUTE_MATERIALITY: Record<string, number> = {
  "conditions.surface": 3,
  "weather.condition": 3,
  "visibility.ambient": 3,
};

export function eventMateriality(key: string): number {
  return EVENT_MATERIALITY[key] ?? 2;
}

export function attributeMateriality(subject: string, predicate: string): number {
  const known = ATTRIBUTE_MATERIALITY[subject + "." + predicate];
  if (known !== undefined) return known;
  // Vehicle identification helps place who was where; direction is causal.
  if (predicate === "direction") return 3;
  if (predicate === "color" || predicate === "place_id") return 2;
  return 1;
}
/** Attributes that are mutually exclusive — two different values is a real conflict. */
export const EXCLUSIVE_PREDICATES = new Set([
  "color",
  "direction",
  "count",
  "place_id",
  // Environmental state is mutually exclusive and, unlike most testimony,
  // independently checkable against a weather record.
  "surface",
  "condition",
  "ambient",
]);


/**
 * Conditions at the scene: road surface, weather, and light level.
 *
 * Kept out of the entity/attribute machinery on purpose — "light" already
 * means the traffic signal, and binding "dark" to the nearest noun would
 * produce nonsense. Each entry maps straight to subject.predicate = value.
 */
export interface EnvPattern {
  subject: string;
  predicate: string;
  value: string;
  re: RegExp;
}

export const ENVIRONMENT_PATTERNS: EnvPattern[] = [
  { subject: "conditions", predicate: "surface", value: "wet", re: /\b(?:wet|slick|slippery)\b/ },
  { subject: "conditions", predicate: "surface", value: "dry", re: /\bdry\b/ },
  { subject: "conditions", predicate: "surface", value: "icy", re: /\b(?:icy|ice)\b/ },
  { subject: "weather", predicate: "condition", value: "rain", re: /\b(?:rain|raining|rained|rainy|drizzl(?:e|ing)|downpour)\b/ },
  { subject: "weather", predicate: "condition", value: "clear", re: /\b(?:clear|sunny|fine weather)\b/ },
  { subject: "weather", predicate: "condition", value: "fog", re: /\b(?:fog|foggy|mist|misty|haze)\b/ },
  { subject: "weather", predicate: "condition", value: "cloudy", re: /\b(?:overcast|cloudy)\b/ },
  { subject: "weather", predicate: "condition", value: "snow", re: /\b(?:snow|snowing|sleet)\b/ },
  { subject: "visibility", predicate: "ambient", value: "dark", re: /\b(?:dark|night ?time|pitch black)\b/ },
  { subject: "visibility", predicate: "ambient", value: "daylight", re: /\b(?:daylight|broad daylight|still light out)\b/ },
  { subject: "visibility", predicate: "ambient", value: "dusk", re: /\b(?:dusk|twilight|getting dark)\b/ },
];
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
