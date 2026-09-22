import type { AppState } from "./types";

export function subscribe(
  onState: (state: AppState) => void,
  onStatus: (connected: boolean) => void,
): () => void {
  let es: EventSource | null = null;
  let retry: number | undefined;
  let closed = false;

  const open = () => {
    if (closed) return;
    es = new EventSource("/api/stream");
    es.onopen = () => onStatus(true);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.state) onState(msg.state as AppState);
      } catch (err) {
        console.error("bad SSE payload", err);
      }
    };
    es.onerror = () => {
      onStatus(false);
      es?.close();
      // A dropped stream must never require a page reload mid-interview.
      retry = window.setTimeout(open, 2000);
    };
  };

  open();
  return () => {
    closed = true;
    window.clearTimeout(retry);
    es?.close();
  };
}

export async function post<T = unknown>(
  path: string,
  body?: unknown,
  method: "POST" | "DELETE" | "PATCH" = "POST",
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}
