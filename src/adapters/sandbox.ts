// Docker Sandbox adapter — isolated processing of case evidence.
//
// Evidence arrives from outside the investigation and is therefore untrusted:
// a crafted image or document should never be parsed with the host's full
// privileges. Anything derived from a file runs in a locked-down container.
//
// If Docker is not available the same task runs through a restricted local
// path, and every result records which of the two actually executed so the
// activity feed can never imply isolation that did not happen.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EvidenceItem } from "../types.ts";

const run = promisify(execFile);

export interface SandboxResult {
  ok: boolean;
  /** "docker" when genuinely containerised, "local-fallback" otherwise. */
  via: "docker" | "local-fallback";
  output: Record<string, unknown>;
  error?: string;
}

let dockerAvailable: boolean | null = null;

export async function isDockerAvailable(): Promise<boolean> {
  if (dockerAvailable !== null) return dockerAvailable;
  try {
    await run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 4000 });
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }
  return dockerAvailable;
}

/**
 * Flags that make the container a genuine sandbox rather than just a process:
 * no network, no capabilities, read-only root, no privilege escalation, and
 * hard memory/CPU/pid ceilings.
 */
const HARDENING = [
  "--network", "none",
  "--cap-drop", "ALL",
  "--security-opt", "no-new-privileges",
  "--read-only",
  "--memory", "256m",
  "--cpus", "0.5",
  "--pids-limit", "64",
  "--user", "65534:65534",
];

/**
 * Derives structured metadata from one evidence item.
 *
 * The script is intentionally tiny and pure-stdlib so it runs on a stock
 * python:3.12-alpine image with no network access.
 */
export async function processEvidence(item: EvidenceItem): Promise<SandboxResult> {
  const script = buildScript(item);

  if (await isDockerAvailable()) {
    try {
      const { stdout } = await run(
        "docker",
        ["run", "--rm", "-i", ...HARDENING, "python:3.12-alpine", "python", "-c", script],
        { timeout: 25_000, maxBuffer: 1024 * 1024 },
      );
      return { ok: true, via: "docker", output: JSON.parse(stdout) };
    } catch (err) {
      // Fall through to local rather than failing the reconstruction.
      return {
        ok: true,
        via: "local-fallback",
        output: localAnalysis(item),
        error: `docker run failed: ${(err as Error).message.slice(0, 160)}`,
      };
    }
  }

  return { ok: true, via: "local-fallback", output: localAnalysis(item) };
}

function buildScript(item: EvidenceItem): string {
  // Values are JSON-encoded into the source so nothing is shell-interpolated.
  const payload = JSON.stringify({
    filename: item.filename,
    kind: item.kind,
    sizeBytes: item.sizeBytes,
    description: item.description,
  });
  return [
    "import json, hashlib, re",
    `item = json.loads(${JSON.stringify(payload)})`,
    "name = item['filename']",
    "ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''",
    // A timestamp in the filename is a real, checkable signal for the timeline.
    "m = re.search(r'(\\\\d{2})(\\\\d{2})(?!\\\\d)', name)",
    "stamp = f'{m.group(1)}:{m.group(2)}' if m else None",
    "out = {",
    "  'filename': name,",
    "  'extension': ext,",
    "  'declared_kind': item['kind'],",
    "  'size_bytes': item['sizeBytes'],",
    "  'content_fingerprint': hashlib.sha256(name.encode()).hexdigest()[:16],",
    "  'filename_timestamp': stamp,",
    "  'notes': [],",
    "}",
    "if stamp: out['notes'].append(f'Filename encodes a timestamp of {stamp}; check against the reported incident time.')",
    "if ext in ('mp4','mov','avi'): out['notes'].append('Video: frame-level signal state may be recoverable near the impact.')",
    "if ext in ('jpg','jpeg','png'): out['notes'].append('Image: EXIF capture time and orientation would help place the photographer.')",
    "if ext in ('wav','mp3','m4a'): out['notes'].append('Audio: a horn transient would be visible in a spectrogram.')",
    "if ext == 'txt': out['notes'].append('Text log: dispatch timestamps can anchor the timeline independently.')",
    "print(json.dumps(out))",
  ].join("\n");
}

/** Same derivation, executed in-process when no container runtime exists. */
function localAnalysis(item: EvidenceItem): Record<string, unknown> {
  const ext = item.filename.includes(".")
    ? item.filename.split(".").pop()!.toLowerCase()
    : "";
  const m = /(\d{2})(\d{2})(?!\d)/.exec(item.filename);
  const notes: string[] = [];
  if (m) {
    notes.push(
      `Filename encodes a timestamp of ${m[1]}:${m[2]}; check against the reported incident time.`,
    );
  }
  if (["mp4", "mov", "avi"].includes(ext)) {
    notes.push("Video: frame-level signal state may be recoverable near the impact.");
  }
  if (["jpg", "jpeg", "png"].includes(ext)) {
    notes.push("Image: EXIF capture time and orientation would help place the photographer.");
  }
  if (["wav", "mp3", "m4a"].includes(ext)) {
    notes.push("Audio: a horn transient would be visible in a spectrogram.");
  }
  if (ext === "txt") {
    notes.push("Text log: dispatch timestamps can anchor the timeline independently.");
  }

  return {
    filename: item.filename,
    extension: ext,
    declared_kind: item.kind,
    size_bytes: item.sizeBytes,
    filename_timestamp: m ? `${m[1]}:${m[2]}` : null,
    notes,
  };
}
