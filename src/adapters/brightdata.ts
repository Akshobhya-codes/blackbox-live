// Bright Data adapter — fresh public context that can corroborate or challenge
// a recollection.
//
// Talks to the official MCP server (`npx @brightdata/mcp`) over stdio using the
// Model Context Protocol SDK. Without an API token the adapter returns the
// case's demo fixtures instead, tagged `demo_fixture`, so a source's origin is
// always visible in the UI and a fixture can never be mistaken for a retrieval.

import type { ExternalSource } from "../types.ts";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export function brightDataConfigured(): boolean {
  return Boolean(process.env.BRIGHTDATA_API_TOKEN?.trim());
}

type McpClient = {
  callTool: (args: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
  close: () => Promise<void>;
};

let clientPromise: Promise<McpClient | null> | null = null;

/**
 * Starts the MCP server once and reuses the session. Imports are dynamic so a
 * missing optional dependency degrades to fixtures instead of crashing boot.
 */
async function getClient(): Promise<McpClient | null> {
  if (!brightDataConfigured()) return null;
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    try {
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const { StdioClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/stdio.js"
      );

      const transport = new StdioClientTransport({
        command: process.platform === "win32" ? "npx.cmd" : "npx",
        args: ["-y", "@brightdata/mcp"],
        env: {
          ...(process.env as Record<string, string>),
          API_TOKEN: process.env.BRIGHTDATA_API_TOKEN!,
        },
      });

      const client = new Client({ name: "blackbox", version: "1.0.0" }, { capabilities: {} });
      await client.connect(transport);
      console.log("[brightdata] MCP session established");
      return client as unknown as McpClient;
    } catch (err) {
      console.warn("[brightdata] MCP unavailable:", (err as Error).message);
      return null;
    }
  })();

  return clientPromise;
}

/** Pulls text out of an MCP tool result without assuming a single shape. */
function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] })?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text!)
    .join("\n");
}

/** Very tolerant parse of a SERP payload into hits. */
function parseHits(raw: string, limit: number): SearchHit[] {
  if (!raw.trim()) return [];

  try {
    const json = JSON.parse(raw);
    const rows = Array.isArray(json) ? json : (json.organic ?? json.results ?? []);
    if (Array.isArray(rows) && rows.length) {
      return rows.slice(0, limit).map((r: Record<string, unknown>) => ({
        title: String(r.title ?? r.name ?? "Untitled result"),
        url: String(r.link ?? r.url ?? ""),
        snippet: String(r.snippet ?? r.description ?? "").slice(0, 400),
      }));
    }
  } catch {
    // Markdown fallback: pull the first few links with their labels.
  }

  const hits: SearchHit[] = [];
  const re = /\[([^\]]{4,140})\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null && hits.length < limit) {
    hits.push({ title: m[1], url: m[2], snippet: "" });
  }
  return hits;
}

/** One public-web search. Returns [] rather than throwing. */
export async function search(query: string, limit = 3): Promise<SearchHit[]> {
  const client = await getClient();
  if (!client) return [];
  try {
    const result = await client.callTool({
      name: "search_engine",
      arguments: { query, engine: "google" },
    });
    return parseHits(textOf(result), limit);
  } catch (err) {
    console.warn(`[brightdata] search failed for "${query}":`, (err as Error).message);
    return [];
  }
}

export async function scrape(url: string): Promise<string> {
  const client = await getClient();
  if (!client) return "";
  try {
    return textOf(await client.callTool({ name: "scrape_as_markdown", arguments: { url } }));
  } catch (err) {
    console.warn("[brightdata] scrape failed:", (err as Error).message);
    return "";
  }
}

export interface ResearchRequest {
  query: string;
  /** Authoritative page to read when SERP is unavailable on the account. */
  url?: string;
  title?: string;
  category: ExternalSource["category"];
  relevance: string;
  bearing: ExternalSource["bearing"];
}

/** Pulls a readable snippet out of a scraped markdown page. */
function snippetFrom(markdown: string, maxLen = 340): string {
  const line = markdown
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s|]+/, "").trim())
    // Skip nav chrome and link-only lines; keep the first real sentence.
    .find((l) => l.length > 60 && !/^\[|^!\[|^https?:/.test(l));
  const text = (line ?? markdown.replace(/\s+/g, " ")).trim();
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1).trimEnd() + "…";
}

function titleFrom(markdown: string, fallback: string): string {
  const h1 = /^#\s+(.{4,120})$/m.exec(markdown);
  return h1 ? h1[1].trim() : fallback;
}

/**
 * Runs the case's research plan against Bright Data.
 *
 * Prefers SERP, but falls back to reading a named authoritative page when the
 * account has no usable SERP zone — scraping and search are separate products
 * and an account can have one without the other. Either way the result is a
 * live retrieval, and `provider` records which tool actually produced it.
 * A request that yields nothing contributes no source; the caller decides
 * whether to fall back to fixtures.
 */
export async function research(
  requests: ResearchRequest[],
  incidentId: string,
): Promise<Omit<ExternalSource, "id">[]> {
  const out: Omit<ExternalSource, "id">[] = [];

  for (const req of requests) {
    const base = {
      incidentId,
      category: req.category,
      retrievedAt: new Date().toISOString(),
      relevance: req.relevance,
      relatedClaimIds: [] as string[],
      bearing: req.bearing,
    };

    const hits = await search(req.query, 1);
    if (hits.length > 0 && hits[0].url) {
      out.push({
        ...base,
        title: hits[0].title,
        url: hits[0].url,
        snippet: hits[0].snippet || "(no snippet returned)",
        provider: "brightdata:search_engine",
      });
      continue;
    }

    if (!req.url) continue;
    const markdown = await scrape(req.url);
    if (!markdown.trim()) continue;

    out.push({
      ...base,
      title: titleFrom(markdown, req.title ?? req.url),
      url: req.url,
      snippet: snippetFrom(markdown),
      provider: "brightdata:scrape_as_markdown",
    });
  }

  return out;
}

export async function shutdown(): Promise<void> {
  const client = await clientPromise;
  if (client) await client.close().catch(() => {});
  clientPromise = null;
}
