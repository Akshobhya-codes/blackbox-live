// Environmental verification.
//
// Witnesses are asked things that an independent record can settle: what the
// weather was doing, whether the road was wet, whether it was dark. Those
// answers are then checked against a real observation retrieved through Bright
// Data, and the claim is marked supported or contradicted by external evidence.
//
// This is corroboration, not lie detection. People misremember weather
// constantly, and a mismatch says the recollection is unreliable on that point
// — never that the person is dishonest. The classification vocabulary reflects
// that: the strongest verdict available is "contradicted by external evidence".

import { scrape } from "./brightdata.ts";

export interface WeatherRecord {
  /** Canonical condition: clear | rain | fog | cloudy | snow. */
  condition: string;
  description: string;
  tempC: number | null;
  visibilityKm: number | null;
  precipMM: number | null;
  /** Whether it was dark at the observed hour. */
  dark: boolean | null;
  observedAt: string;
  sourceUrl: string;
  /** Which path actually served it, so provenance stays honest. */
  via: "brightdata:scrape_as_markdown" | "direct";
}

/** Maps a provider's prose description onto our canonical vocabulary. */
export function canonicalCondition(desc: string): string {
  const d = desc.toLowerCase();
  if (/snow|sleet|blizzard/.test(d)) return "snow";
  if (/thunder|storm/.test(d)) return "rain";
  if (/rain|drizzle|shower/.test(d)) return "rain";
  if (/fog|mist|haze/.test(d)) return "fog";
  if (/overcast|cloud/.test(d)) return "cloudy";
  if (/clear|sunny|fair/.test(d)) return "clear";
  return d.split(/[,.]/)[0].trim() || "unknown";
}

/** City name for the weather lookup, taken from the case's location string. */
export function cityOf(location: string): string {
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  // "Harrison Street & 4th Street, San Francisco" -> "San Francisco"
  const city = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return city.replace(/\b(CA|California|USA)\b/gi, "").trim() || "San Francisco";
}

/** Hour of day from a human time like "8:42 PM". Null when unparseable. */
export function hourOf(approximateTime: string): number | null {
  const m = /(\d{1,2})\s*[:.]?\s*(\d{2})?\s*(a\.?m\.?|p\.?m\.?)?/i.exec(approximateTime);
  if (!m) return null;
  let h = Number(m[1]);
  if (h > 23) return null;
  const mer = m[3]?.toLowerCase().replace(/\./g, "");
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  return h;
}

interface WttrHour {
  time?: string;
  weatherDesc?: { value?: string }[];
  tempC?: string;
  visibility?: string;
  precipMM?: string;
}

interface WttrPayload {
  current_condition?: WttrHour[];
  weather?: { date?: string; hourly?: WttrHour[] }[];
}

/**
 * Retrieves an independent weather observation through Bright Data.
 *
 * Returns null rather than guessing: an unavailable record must leave claims
 * unverified, never produce a fabricated "check".
 */
export async function fetchWeather(
  location: string,
  approximateTime: string,
): Promise<WeatherRecord | null> {
  const city = cityOf(location);
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;

  // Bright Data first, so the retrieval goes through the same egress as the
  // rest of our public-record work. It shares one MCP session with the search
  // plan though, and a contended session can take longer than an investigator
  // will wait — so a direct read backs it up. Whichever served it is recorded
  // on the source rather than glossed over.
  let data: WttrPayload | null = null;
  let via: WeatherRecord["via"] = "brightdata:scrape_as_markdown";

  const raw = await scrape(url).catch(() => "");
  if (raw.trim()) data = parsePayload(raw);

  if (!data) {
    via = "direct";
    data = await fetchDirect(url);
  }
  if (!data) return null;

  const hour = hourOf(approximateTime);
  const slot = pickHour(data, hour);
  if (!slot) return null;

  const description = slot.weatherDesc?.[0]?.value?.trim() || "unknown";
  const num = (v?: string) => (v === undefined || v === "" ? null : Number(v));

  return {
    condition: canonicalCondition(description),
    description,
    tempC: num(slot.tempC),
    visibilityKm: num(slot.visibility),
    precipMM: num(slot.precipMM),
    dark: hour === null ? null : hour >= 19 || hour <= 6,
    observedAt: hour === null ? "current observation" : `${String(hour).padStart(2, "0")}:00`,
    sourceUrl: url,
    via,
  };
}

/**
 * Parses the provider's JSON out of scraped markdown.
 *
 * The scraper backslash-escapes punctuation that JSON needs literally —
 * `"current\_condition"` and `\[` both appear. Only markdown's own escapes are
 * stripped; JSON's `\"` and `\\` are left alone or valid strings break.
 */
function parsePayload(raw: string): WttrPayload | null {
  const cleaned = raw.replace(/\\([_[\]*`~#+\-.!])/g, "$1");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as WttrPayload;
  } catch {
    return null;
  }
}

/** Plain HTTPS read, used when the proxied path is slow or unparseable. */
async function fetchDirect(url: string): Promise<WttrPayload | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "curl/8" }, // wttr.in serves JSON to curl-ish agents
    });
    if (!res.ok) return null;
    return (await res.json()) as WttrPayload;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The hourly slot nearest the incident, falling back to current conditions. */
function pickHour(data: WttrPayload, hour: number | null): WttrHour | null {
  if (hour !== null) {
    const today = data.weather?.[0]?.hourly ?? [];
    let best: WttrHour | null = null;
    let bestGap = Infinity;
    for (const h of today) {
      // wttr encodes hourly slots as "0", "300", "600" … i.e. HHMM.
      const slotHour = Math.floor(Number(h.time ?? "0") / 100);
      if (!Number.isFinite(slotHour)) continue;
      const gap = Math.abs(slotHour - hour);
      if (gap < bestGap) {
        bestGap = gap;
        best = h;
      }
    }
    if (best) return best;
  }
  return data.current_condition?.[0] ?? null;
}
