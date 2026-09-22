// Client for the Python brain service (Cognee memory + Strands agents).
//
// The service is optional. Every call has a short timeout and returns a null
// result rather than throwing, so a brain that is slow, down, or never started
// degrades the reconstruction gracefully instead of stopping it.

const BASE = process.env.BRAIN_URL?.trim() || "http://127.0.0.1:8077";
// Same reasoning as the LLM client: a brain that is slow or unreachable must
// not hold up the reconstruction. The local report is a fine substitute.
const TIMEOUT_MS = 35_000;

export interface AdapterHealth {
  mode: "live" | "demo" | "unavailable";
  detail: string;
}

export interface BrainHealth {
  reachable: boolean;
  cognee: AdapterHealth;
  strands: AdapterHealth;
}

const DOWN: BrainHealth = {
  reachable: false,
  cognee: { mode: "unavailable", detail: "brain service not reachable" },
  strands: { mode: "unavailable", detail: "brain service not reachable" },
};

async function call<T>(path: string, body?: unknown, timeout = TIMEOUT_MS): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function health(): Promise<BrainHealth> {
  const res = await call<Omit<BrainHealth, "reachable">>("/health", undefined, 3000);
  return res ? { reachable: true, ...res } : DOWN;
}

export interface IngestResult {
  ok: boolean;
  mode: string;
  documents?: number;
  detail?: string;
}

/** Writes the case into Cognee as connected memory. */
export async function ingest(dataset: string, documents: string[]): Promise<IngestResult | null> {
  return call<IngestResult>("/memory/ingest", { dataset, documents });
}

export interface RecallResult {
  ok: boolean;
  mode: string;
  results: string[];
  detail?: string;
}

/** Queries the case graph. */
export async function recall(dataset: string, query: string): Promise<RecallResult | null> {
  return call<RecallResult>("/memory/recall", { dataset, query });
}

export interface StrandsReport {
  summary: string;
  established: string[];
  disputed: string[];
  unresolved: string[];
  recommended_next_action: string;
  confidence: number;
  confidence_basis: string;
}

export interface ReportResult {
  ok: boolean;
  mode: string;
  provider?: string;
  report?: StrandsReport;
  detail?: string;
}

/** Runs the Strands Report Agent over the reconciled case. */
export async function generateReport(payload: unknown): Promise<ReportResult | null> {
  return call<ReportResult>("/agents/report", { payload });
}
