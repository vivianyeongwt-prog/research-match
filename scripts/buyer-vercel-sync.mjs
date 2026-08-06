// Uploads buyer-owned ResearchMatch values to the already-transferred Vercel
// project. Values travel through stdin and are never printed or put in argv.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  SECRET_ENV_NAMES,
  VERCEL_ENV_NAMES,
  parseDotenv,
  validateProductionEnvironment,
} from "./lib/buyer-setup-config.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const VERCEL_VERSION = "58.5.1";

function firstUsefulLine(source) {
  return String(source ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("Vercel CLI"));
}

function sanitize(source, values) {
  let safe = String(source ?? "");
  for (const value of Object.values(values).sort((a, b) => b.length - a.length)) {
    if (value.length >= 8) safe = safe.split(value).join("[hidden]");
  }
  return safe;
}

export function vercelUploadPlan(values) {
  return VERCEL_ENV_NAMES.filter((name) => String(values[name] ?? "").trim()).map((name) => ({
    name,
    value: String(values[name]).trim(),
    sensitive: SECRET_ENV_NAMES.has(name),
  }));
}

export function syncVercelEnvironment({
  values,
  root = ROOT,
  apply = false,
  run = spawnSync,
  onProgress = () => {},
}) {
  const errors = validateProductionEnvironment(values);
  if (errors.length > 0) {
    throw new Error(`Production configuration is not ready:\n- ${errors.join("\n- ")}`);
  }
  const linkFile = path.join(root, ".vercel", "project.json");
  if (!fs.existsSync(linkFile)) {
    throw new Error("This checkout is not linked to Vercel. Run `npx vercel link` first.");
  }
  let link;
  try {
    link = JSON.parse(fs.readFileSync(linkFile, "utf8"));
  } catch {
    throw new Error(".vercel/project.json is unreadable. Run `npx vercel link` again.");
  }
  if (!link.projectId || typeof link.projectId !== "string") {
    throw new Error("The Vercel link has no project ID. Run `npx vercel link` again.");
  }

  const plan = vercelUploadPlan(values);
  if (!apply) return { projectId: link.projectId, plan, applied: 0 };

  let applied = 0;
  for (const item of plan) {
    onProgress(item.name, applied, plan.length);
    const args = [
      "--yes",
      `vercel@${VERCEL_VERSION}`,
      "env",
      "add",
      item.name,
      "production",
      "--force",
      "--yes",
      "--non-interactive",
      "--project",
      link.projectId,
      item.sensitive ? "--sensitive" : "--no-sensitive",
    ];
    const result = run("npx", args, {
      cwd: root,
      env: process.env,
      encoding: "utf8",
      input: `${item.value}\n`,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
    });
    if (result.error) {
      throw new Error(`Vercel could not update ${item.name}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const output = sanitize(`${result.stderr ?? ""}\n${result.stdout ?? ""}`, values);
      throw new Error(
        `Vercel could not update ${item.name}: ${firstUsefulLine(output) || "unknown CLI error"}`
      );
    }
    applied += 1;
  }
  return { projectId: link.projectId, plan, applied };
}

function loadEnvironment(envFile) {
  if (!fs.existsSync(envFile)) {
    throw new Error(`${path.relative(ROOT, envFile)} is missing. Run npm run buyer:setup first.`);
  }
  return parseDotenv(fs.readFileSync(envFile, "utf8"));
}

function main() {
  const args = process.argv.slice(2);
  const envIndex = args.indexOf("--env-file");
  const envFile = path.resolve(
    ROOT,
    envIndex >= 0 && args[envIndex + 1] ? args[envIndex + 1] : ".env.local"
  );
  const apply = args.includes("--apply");
  const values = loadEnvironment(envFile);
  const result = syncVercelEnvironment({
    values,
    apply,
    onProgress(name, complete, total) {
      console.log(`[${complete + 1}/${total}] Updating ${name} (value hidden)`);
    },
  });

  if (!apply) {
    console.log(`Vercel production plan for ${result.projectId}`);
    for (const item of result.plan) {
      console.log(`- ${item.name}${item.sensitive ? " (sensitive)" : ""}`);
    }
    console.log("No Vercel value was changed. Run npm run buyer:vercel:apply when ready.");
    return;
  }
  console.log(`Updated ${result.applied} Vercel Production variables. Secret values were never printed.`);
  console.log("Vercel applies them to the next deployment; redeploy, then run npm run handoff:check:production.");
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
