// Seeded demo case BB-204 — Harrison & 4th Collision.
//
// Every name, number, recording, and document here is fictional. The phone
// numbers are in the 555 reserved range and dial nowhere.
//
// The statements are written so the reconciliation engine has real work to do:
// several details corroborate cleanly across accounts, several genuinely
// conflict, and the overall question of responsibility stays open. No
// participant is written as the obvious culprit — that is the point.

import type { EvidenceItem, ExternalSource, ParticipantRole } from "../types.ts";

export const BB204_CASE = {
  title: "Harrison & 4th Collision",
  type: "Traffic collision",
  location: "Harrison Street & 4th Street, San Francisco",
  approximateTime: "8:42 PM",
  description:
    "Two-vehicle collision at a signalled intersection. A northbound Tesla and a westbound " +
    "Honda collided in the intersection box. Both drivers report having had a green signal. " +
    "No fatalities reported.",
  referenceId: "BB-204",
  openedBy: "SFPD Traffic Collision Investigation Unit",
  knownContext:
    "911 call logged at 20:43. Two vehicles involved: a black Tesla sedan (northbound on 4th) " +
    "and a white Honda (westbound on Harrison). Both drivers ambulatory at scene; one reported " +
    "neck pain and was transported for assessment. Intersection is signal-controlled with no " +
    "protected left phase. Municipal signal-timing log has been requested but not yet received. " +
    "No independent camera footage recovered so far. Point of impact and signal state at entry " +
    "are both unestablished.",
};

export interface SeedParticipant {
  displayName: string;
  phoneNumber: string;
  role: ParticipantRole;
  descriptor: string;
  approach?: string;
  /** What this person says, one utterance per transcript segment. */
  statement: string[];
}

export const BB204_PARTICIPANTS: SeedParticipant[] = [
  {
    displayName: "Maya Chen",
    phoneNumber: "+14155550142",
    role: "driver",
    descriptor: "Driver — black Tesla",
    approach: "northbound on 4th Street",
    statement: [
      "I was heading north on 4th Street, coming up to Harrison.",
      "My light was green. I am certain about that.",
      "I entered the intersection at about 8:42.",
      "A white Honda came through from my left and struck my passenger side.",
      "I braked as soon as I saw it, but there was no time.",
      "I did not hear a horn before the impact.",
    ],
  },
  {
    displayName: "Ethan Brooks",
    phoneNumber: "+14155550178",
    role: "driver",
    descriptor: "Driver — white Honda",
    approach: "westbound on Harrison Street",
    statement: [
      "I was westbound on Harrison approaching 4th.",
      "The light was green for me when I entered the intersection.",
      "A black Tesla accelerated into the intersection from my right.",
      "I pressed my horn just before we collided.",
      "I braked hard.",
      "It was closer to 8:50, I think.",
    ],
  },
  {
    displayName: "Daniel Ortiz",
    phoneNumber: "+14155550193",
    role: "pedestrian",
    descriptor: "Pedestrian — southeast corner",
    approach: "on foot, southeast corner",
    statement: [
      "I was waiting to cross on the southeast corner.",
      "I saw the Tesla coming up 4th and the Honda coming along Harrison.",
      "The signal facing Harrison changed to yellow at about the moment of impact.",
      "Actually the signal might have been red by then, I am not certain.",
      "I heard a horn, then the crash.",
      "It was about 8:45.",
    ],
  },
  {
    displayName: "Priya Shah",
    phoneNumber: "+14155550164",
    role: "employee",
    descriptor: "Employee — cafe on Harrison",
    approach: "indoors, north side of Harrison",
    statement: [
      "I was closing up the cafe on the corner of Harrison.",
      "I heard a horn first, then the impact a second later.",
      "When I looked up the Honda was already well into the intersection.",
      "I could not see the traffic signal from where I was standing.",
      "The Tesla was black and the other car was a white Honda.",
      "It was around 8:45.",
    ],
  },
];

/** Case material. `demo: true` is surfaced in the UI on every item. */
export const BB204_EVIDENCE: Omit<EvidenceItem, "id" | "incidentId">[] = [
  {
    kind: "video",
    filename: "dashcam_front_2043.mp4",
    sizeBytes: 8_412_160,
    uploadedAt: new Date().toISOString(),
    description:
      "Forward dashcam clip surrendered by the Tesla driver. 14 seconds, ends at impact. " +
      "Signal head is out of frame for the final 3 seconds.",
    extracted: null,
    processedAt: null,
    processedBy: null,
    demo: true,
  },
  {
    kind: "image",
    filename: "scene_photo_northeast.jpg",
    sizeBytes: 2_934_712,
    uploadedAt: new Date().toISOString(),
    description:
      "Responding officer scene photograph, looking northeast. Shows final rest positions and " +
      "debris field in the intersection box.",
    extracted: null,
    processedAt: null,
    processedBy: null,
    demo: true,
  },
  {
    kind: "document",
    filename: "911_call_log_2043.txt",
    sizeBytes: 4_096,
    uploadedAt: new Date().toISOString(),
    description: "Computer-aided dispatch extract. First call logged 20:43:11.",
    extracted: null,
    processedAt: null,
    processedBy: null,
    demo: true,
  },
  {
    kind: "audio",
    filename: "interview_audio_placeholder.wav",
    sizeBytes: 1_240_000,
    uploadedAt: new Date().toISOString(),
    description:
      "Placeholder interview audio used for playback controls in the demo. Contains tone, not speech.",
    extracted: null,
    processedAt: null,
    processedBy: null,
    demo: true,
  },
];

/**
 * Deterministic stand-ins for Bright Data results, used only when no API token
 * is configured. Every one is labelled `demo_fixture` in the UI so it can never
 * be mistaken for a live retrieval.
 */
export const BB204_EXTERNAL_FIXTURES: Omit<
  ExternalSource,
  "id" | "incidentId" | "relatedClaimIds"
>[] = [
  {
    title: "San Francisco, CA — hourly conditions for 8:00–9:00 PM",
    url: "https://www.weather.gov/wrh/timeseries?site=KSFO",
    snippet:
      "Clear. Temperature 14 C. Wind 11 km/h W. Visibility 16 km. No precipitation recorded in the hour.",
    category: "weather",
    retrievedAt: new Date().toISOString(),
    relevance:
      "Rules out reduced visibility or wet-road braking distance as an explanation for either driver's account.",
    bearing: "context",
    provider: "demo_fixture",
  },
  {
    title: "SFMTA — Harrison Street signal corridor timing",
    url: "https://www.sfmta.com/projects/harrison-street-safety-project",
    snippet:
      "Harrison Street signals operate on a coordinated corridor cycle. Cross-street approaches " +
      "are interlocked; no protected left-turn phase is provided at 4th Street.",
    category: "traffic_signal",
    relevance:
      "Confirms crossing approaches cannot display green simultaneously, which is what makes the two drivers' accounts jointly impossible.",
    retrievedAt: new Date().toISOString(),
    bearing: "challenges",
    provider: "demo_fixture",
  },
  {
    title: "Harrison St & 4th St — intersection layout",
    url: "https://www.openstreetmap.org/search?query=Harrison%20St%20and%204th%20St%20San%20Francisco",
    snippet:
      "Four-way signalised intersection. Harrison Street runs east-west, one-way westbound at this " +
      "block. 4th Street runs north-south. Marked crosswalks on all four approaches.",
    category: "street_layout",
    relevance:
      "Confirms the two drivers were on crossing approaches and corroborates the pedestrian's stated corner position.",
    retrievedAt: new Date().toISOString(),
    bearing: "supports",
    provider: "demo_fixture",
  },
  {
    title: "Businesses at Harrison & 4th with street-facing frontage",
    url: "https://www.yelp.com/search?find_loc=Harrison+St+%26+4th+St%2C+San+Francisco%2C+CA",
    snippet:
      "Several ground-floor businesses with street-facing windows on the north side of Harrison, " +
      "including a cafe listed as open until 21:00.",
    category: "camera",
    relevance:
      "Identifies a possible private camera with a view of the westbound approach, and is consistent with the cafe employee's stated vantage point.",
    retrievedAt: new Date().toISOString(),
    bearing: "supports",
    provider: "demo_fixture",
  },
  {
    title: "SFMTA temporary traffic advisories — SoMa",
    url: "https://www.sfmta.com/travel-alerts",
    snippet: "No lane closures or signal outages listed for Harrison Street on the incident date.",
    category: "road_closure",
    relevance:
      "No recorded signal fault or closure, so a malfunctioning signal is not currently supported as an explanation.",
    retrievedAt: new Date().toISOString(),
    bearing: "context",
    provider: "demo_fixture",
  },
];

/** The queries the Evidence Researcher issues against Bright Data. */
export function bb204Queries(location: string, time: string): string[] {
  return [
    `weather conditions San Francisco ${time} visibility`,
    `${location} traffic signal timing phasing`,
    `${location} intersection layout lanes`,
    `businesses near ${location} security camera street view`,
    `${location} road closure OR signal outage advisory`,
  ];
}
