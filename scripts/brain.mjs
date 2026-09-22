// Launches the Python brain service from the project venv.
//
// Exists because npm scripts run through cmd.exe on Windows, which rejects
// forward-slash paths in command position, while POSIX shells reject the
// backslash form. Resolving the interpreter here keeps one script working on
// both and gives a useful message when the venv has not been created yet.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

const python = isWindows
  ? join(root, "brain", ".venv", "Scripts", "python.exe")
  : join(root, "brain", ".venv", "bin", "python");

if (!existsSync(python)) {
  console.error(
    "\n  The Python brain service is not set up yet.\n\n" +
      "    python -m venv brain/.venv\n" +
      (isWindows
        ? "    brain\\.venv\\Scripts\\pip install -r brain/requirements.txt\n"
        : "    brain/.venv/bin/pip install -r brain/requirements.txt\n") +
      "\n  BlackBox runs without it — Cognee and Strands will report as unavailable\n" +
      "  and the reconstruction falls back to the local rules engine.\n",
  );
  process.exit(0); // not a build failure; the app is designed to run without it
}

const child = spawn(python, [join(root, "brain", "app.py")], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
