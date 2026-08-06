// Runs the read-only handoff checker with Vercel's production environment while
// isolating it from .env.local. This prevents local test keys from silently
// overriding production values.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const linkFile = path.join(ROOT, ".vercel", "project.json");

if (!fs.existsSync(linkFile)) {
  console.error("This checkout is not linked to Vercel. Run `npx vercel link` first.");
  process.exit(1);
}

let projectId;
try {
  ({ projectId } = JSON.parse(fs.readFileSync(linkFile, "utf8")));
} catch {
  console.error("Could not read .vercel/project.json. Run `npx vercel link` again.");
  process.exit(1);
}
if (!projectId || typeof projectId !== "string") {
  console.error(".vercel/project.json does not contain a projectId.");
  process.exit(1);
}

const isolatedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "researchmatch-handoff-"));
let status = 1;
try {
  const result = spawnSync(
    "npx",
    [
      "--yes",
      "vercel@58.5.1",
      "env",
      "run",
      "--environment",
      "production",
      "--project",
      projectId,
      "--cwd",
      isolatedDirectory,
      "--",
      "node",
      path.join(SCRIPT_DIR, "handoff-readiness.mjs"),
      "--live",
      "--expect-live",
      "--no-env-file",
    ],
    { cwd: ROOT, env: process.env, stdio: "inherit" }
  );
  if (result.error) {
    console.error(`Could not start the Vercel production audit: ${result.error.message}`);
  }
  status = result.status ?? 1;
} finally {
  try {
    fs.rmdirSync(isolatedDirectory);
  } catch {
    console.warn(`Temporary audit directory could not be removed: ${isolatedDirectory}`);
  }
}

process.exit(status);
