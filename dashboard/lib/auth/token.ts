/**
 * Session tokens: `<expiresAtMs>.<nonce>.<hmacSha256(base64url)>`.
 * Uses Web Crypto only, so it runs in the proxy (edge or node) and in server code.
 */
export const SESSION_COOKIE = "gsim_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSession(
  secret: string,
  now: number = Date.now(),
  ttlMs: number = SESSION_TTL_MS,
): Promise<string> {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const body = `${now + ttlMs}.${toBase64Url(nonceBytes)}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

export type VerifyResult = { ok: true; expiresAt: number } | { ok: false; reason: string };

export async function verifySession(
  secret: string,
  token: string | undefined | null,
  now: number = Date.now(),
): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [expText, nonce, sigText] = parts as [string, string, string];
  if (!/^\d{1,16}$/.test(expText) || !nonce) return { ok: false, reason: "malformed" };
  const sig = fromBase64Url(sigText);
  if (!sig) return { ok: false, reason: "malformed" };
  // crypto.subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    sig as Uint8Array<ArrayBuffer>,
    encoder.encode(`${expText}.${nonce}`),
  );
  if (!valid) return { ok: false, reason: "bad_signature" };
  const expiresAt = Number(expText);
  if (expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true, expiresAt };
}

/** Constant-time string equality: compares SHA-256 digests byte by byte. */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}
