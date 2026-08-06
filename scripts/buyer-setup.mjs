// Local-only, secret-safe setup page for a new ResearchMatch owner.

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  BUYER_SETUP_FIELDS,
  configurationStatus,
  ensureGeneratedSecrets,
  environmentUpdatesFromInput,
  parseDotenv,
  renderEnvironmentFile,
  validateEnvironment,
} from "./lib/buyer-setup-config.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");
const MAX_BODY_BYTES = 128 * 1024;

const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);

const GROUPS = [
  {
    id: "identity",
    eyebrow: "Step 1",
    title: "Make it yours",
    description: "Set the public identity and the inboxes you want customers to use.",
  },
  {
    id: "supabase",
    eyebrow: "Step 2",
    title: "Connect the transferred database",
    description: "Use the keys from the Supabase project after it moves into your organization.",
  },
  {
    id: "stripe",
    eyebrow: "Step 3",
    title: "Connect billing",
    description: "Paste the destination-account keys; the automatic setup can create every price and webhook.",
  },
  {
    id: "ai",
    eyebrow: "Step 4",
    title: "Turn on the AI features",
    description: "Groq is required today. Anthropic and Serper are optional upgrades.",
  },
  {
    id: "analytics",
    eyebrow: "Optional",
    title: "Analytics",
    description: "Leave this blank to keep PostHog disabled; Vercel Analytics transfers with the project.",
  },
];

const TRANSFER_CHECKLIST = [
  {
    id: "github",
    label: "Source code",
    detail: "Accept the GitHub repository transfer.",
    url: "https://github.com/notifications",
  },
  {
    id: "supabase",
    label: "Users and database",
    detail: "Receive the existing Supabase project in your organization.",
    url: "https://supabase.com/dashboard",
  },
  {
    id: "stripe",
    label: "Customers and subscriptions",
    detail: "Accept Stripe's customer copy, then upload the subscription migration.",
    url: "https://dashboard.stripe.com/customers",
  },
  {
    id: "vercel",
    label: "Live website",
    detail: "Receive the Vercel project after the new credentials are installed.",
    url: "https://vercel.com/dashboard",
  },
  {
    id: "domain",
    label: "Domain",
    detail: "Accept researchmatch.site in your Namecheap account and verify DNS.",
    url: "https://ap.www.namecheap.com/domains/list/",
  },
];

function commonHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function json(res, status, value) {
  res.writeHead(status, {
    ...commonHeaders(),
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(value));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request is too large."), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const source = Buffer.concat(chunks).toString("utf8");
        resolve(source ? JSON.parse(source) : {});
      } catch {
        reject(Object.assign(new Error("Request must contain valid JSON."), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeEnvironment({ root, envFile, templateSource, inputValues }) {
  const existingSource = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  const existing = parseDotenv(existingSource);
  const submitted = environmentUpdatesFromInput(inputValues);
  const generated = ensureGeneratedSecrets({ ...existing, ...submitted });
  const rendered = renderEnvironmentFile(templateSource, existingSource, {
    ...submitted,
    ...generated,
  });
  const errors = validateEnvironment(rendered.values);

  const privateDirectory = path.join(root, ".handoff-private");
  const backupDirectory = path.join(privateDirectory, "env-backups");
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(privateDirectory, 0o700);
    fs.chmodSync(backupDirectory, 0o700);
  } catch {
    // Some filesystems do not expose POSIX permissions. The directory remains gitignored.
  }

  let backup = null;
  if (existingSource) {
    backup = path.join(backupDirectory, `.env.local.${timestamp()}.backup`);
    fs.writeFileSync(backup, existingSource, { encoding: "utf8", mode: 0o600 });
  }

  const temporary = `${envFile}.buyer-setup-${process.pid}`;
  fs.writeFileSync(temporary, rendered.source, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, envFile);
  try {
    fs.chmodSync(envFile, 0o600);
  } catch {
    // Best-effort on non-POSIX filesystems.
  }

  return {
    backup: backup ? path.relative(root, backup) : null,
    errors,
    status: configurationStatus(rendered.values),
  };
}

function readEnvironment(envFile) {
  return fs.existsSync(envFile) ? parseDotenv(fs.readFileSync(envFile, "utf8")) : {};
}

function redact(source, values) {
  let safe = String(source ?? "");
  const candidates = Object.values(values)
    .map((value) => String(value ?? ""))
    .filter((value) => value.length >= 8)
    .sort((a, b) => b.length - a.length);
  for (const value of candidates) safe = safe.split(value).join("[hidden]");
  return safe;
}

function runAudit(root, envFile) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts", "handoff-readiness.mjs"), "--env-file", envFile],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 45_000,
    }
  );
  const values = readEnvironment(envFile);
  const output = redact(`${result.stdout ?? ""}${result.stderr ?? ""}`, values).trim();
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    output: output || "The checker did not return any output.",
  };
}

function publicFields() {
  return BUYER_SETUP_FIELDS.map((field) => ({
    id: field.id,
    group: field.group,
    label: field.label,
    description: field.description,
    placeholder: field.placeholder,
    level: field.level,
    secret: Boolean(field.secret),
    advanced: Boolean(field.advanced),
    helpUrl: field.helpUrl ?? null,
  }));
}

function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command[0], command[1], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // The printed URL remains a complete fallback.
  }
}

export function createBuyerSetupServer({
  root = DEFAULT_ROOT,
  envFile = path.join(root, ".env.local"),
  token = crypto.randomBytes(24).toString("base64url"),
} = {}) {
  const setupDirectory = path.join(root, "handoff", "setup");
  const templatePath = path.join(root, ".env.example");
  if (!fs.existsSync(templatePath)) throw new Error(".env.example is missing.");
  const templateSource = fs.readFileSync(templatePath, "utf8");
  let port = null;

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!allowedHosts.has(req.headers.host ?? "")) {
      json(res, 403, { error: "This setup page only accepts local requests." });
      return;
    }

    if (STATIC_FILES.has(requestUrl.pathname) && req.method === "GET") {
      const [name, contentType] = STATIC_FILES.get(requestUrl.pathname);
      const absolute = path.join(setupDirectory, name);
      if (!fs.existsSync(absolute)) {
        json(res, 404, { error: "Setup asset not found." });
        return;
      }
      res.writeHead(200, { ...commonHeaders(), "Content-Type": contentType });
      fs.createReadStream(absolute).pipe(res);
      return;
    }

    if (!requestUrl.pathname.startsWith("/api/")) {
      json(res, 404, { error: "Not found." });
      return;
    }
    const expectedOrigins = new Set([
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
    ]);
    if (
      !safeEqual(req.headers["x-setup-token"], token) ||
      (req.method !== "GET" && !expectedOrigins.has(req.headers.origin ?? ""))
    ) {
      json(res, 403, { error: "This setup session is no longer valid. Restart npm run buyer:setup." });
      return;
    }

    try {
      if (requestUrl.pathname === "/api/bootstrap" && req.method === "GET") {
        const status = configurationStatus(readEnvironment(envFile));
        json(res, 200, {
          groups: GROUPS,
          fields: publicFields(),
          status,
          transferChecklist: TRANSFER_CHECKLIST,
          envFileExists: fs.existsSync(envFile),
          vercelLinked: fs.existsSync(path.join(root, ".vercel", "project.json")),
        });
        return;
      }

      if (requestUrl.pathname === "/api/save" && req.method === "POST") {
        if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
          json(res, 415, { error: "Use application/json for setup changes." });
          return;
        }
        const body = await readJsonBody(req);
        const saved = writeEnvironment({
          root,
          envFile,
          templateSource,
          inputValues: body.values,
        });
        json(res, 200, {
          ...saved,
          audit: runAudit(root, envFile),
          message: "Private configuration saved. Secret values were not returned to the browser.",
        });
        return;
      }

      if (requestUrl.pathname === "/api/check" && req.method === "POST") {
        json(res, 200, {
          audit: runAudit(root, envFile),
          status: configurationStatus(readEnvironment(envFile)),
        });
        return;
      }

      if (requestUrl.pathname === "/api/shutdown" && req.method === "POST") {
        json(res, 200, { message: "Setup closed. You can close this tab." });
        setTimeout(() => server.close(), 150).unref();
        return;
      }

      json(res, 404, { error: "Not found." });
    } catch (error) {
      const statusCode = Number(error.statusCode) || (error.fieldErrors ? 422 : 500);
      json(res, statusCode, {
        error: statusCode >= 500 ? "Setup could not finish that action." : error.message,
        fieldErrors: error.fieldErrors ?? null,
      });
    }
  });

  return {
    server,
    token,
    listen(requestedPort = 0) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(requestedPort, "127.0.0.1", () => {
          port = server.address().port;
          resolve({ port, url: `http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}` });
        });
      });
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const portIndex = args.indexOf("--port");
  const requestedPort =
    portIndex >= 0 && args[portIndex + 1] ? Number(args[portIndex + 1]) : 0;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
    console.error("--port must be a whole number between 0 and 65535.");
    process.exit(1);
  }
  const setup = createBuyerSetupServer();
  const { url } = await setup.listen(requestedPort);
  console.log("ResearchMatch buyer setup is ready.");
  console.log(`Open this private local page: ${url}`);
  console.log("Press Ctrl+C to close it. Secrets are saved only to the gitignored .env.local file.");
  if (!args.includes("--no-open")) openBrowser(url);
}

if (path.resolve(process.argv[1] ?? "") === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
