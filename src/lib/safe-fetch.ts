import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 3;
const MAX_TEXT_BYTES = 250_000;

function blockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function parseIpv6(address: string) {
  let normalized = address.toLowerCase().split("%")[0].replace(/^\[|\]$/g, "");
  const dottedTail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dottedTail) {
    const octets = dottedTail.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null;
    }
    const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    normalized = normalized.slice(0, -dottedTail.length) + replacement;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const omitted = 8 - head.length - tail.length;
  if (omitted < 0 || (halves.length === 2 && omitted < 1)) return null;

  const rawParts = [...head, ...Array(omitted).fill("0"), ...tail];
  const parts = rawParts.map((part) => (/^[0-9a-f]{1,4}$/.test(part) ? Number.parseInt(part, 16) : NaN));
  return parts.length === 8 && parts.every(Number.isInteger) ? parts : null;
}

function blockedIp(address: string) {
  const normalized = address.toLowerCase().split("%")[0].replace(/^\[|\]$/g, "");
  if (isIP(normalized) === 4) return blockedIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  const parts = parseIpv6(normalized);
  if (!parts) return true;
  const [a, b, c, d, e, f, g, h] = parts;
  if (parts.every((part) => part === 0) || parts.slice(0, 7).every((part) => part === 0) && h === 1) return true;
  if ((a & 0xfe00) === 0xfc00 || (a & 0xffc0) === 0xfe80 || (a & 0xffc0) === 0xfec0) return true;
  if ((a & 0xff00) === 0xff00) return true;

  // IPv4-compatible and IPv4-mapped addresses can disguise a private IPv4
  // destination inside an IPv6 literal.
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0 || f === 0xffff)) {
    const mapped = `${g >> 8}.${g & 0xff}.${h >> 8}.${h & 0xff}`;
    return blockedIpv4(mapped);
  }

  // Translation/tunneling and non-routable documentation ranges are blocked
  // conservatively because they can encode a destination that differs from the
  // visible URL.
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return true;
  if (a === 0x100 && b === 0 && c === 0 && d === 0) return true;
  if (a === 0x2001 && (b === 0 || b === 0x0db8)) return true;
  if (a === 0x2002) return true;
  return false;
}

async function validatePublicHttpsUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new Error("Only public HTTPS URLs are allowed");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local network URLs are not allowed");
  }
  if (isIP(host)) {
    if (blockedIp(host)) throw new Error("Private network URLs are not allowed");
    return url;
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => blockedIp(address))) {
    throw new Error("URL does not resolve to a public network address");
  }
  return url;
}

async function readTextLimited(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_TEXT_BYTES) throw new Error("Response is too large");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_TEXT_BYTES) {
      await reader.cancel();
      throw new Error("Response is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Fetch text from an untrusted discovery URL with redirect and private-network checks. */
export async function safeFetchText(raw: string, headers: HeadersInit = {}) {
  let url = await validatePublicHttpsUrl(raw);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetch(url, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(4_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("Unsafe redirect chain");
      url = await validatePublicHttpsUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Remote page returned ${response.status}`);
    return readTextLimited(response);
  }
  throw new Error("Too many redirects");
}
