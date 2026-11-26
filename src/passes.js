// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 shiftbloom studio and contributors
//
// Passes: signed-in people get more conversions without convert learning who they are.
// A pass is a Privacy Pass token (RFC 9577/9578, type 2, blind RSA) from a stem issuer. The browser
// fetches a batch from stem and spends one per conversion once the free allowance of its connection
// is used up. This file is the server side: the challenge passes are bound to, the issuer's keys,
// checking a pass, and a Durable Object that remembers spent passes.
//
// Off unless PASS_ISSUER is set (e.g. https://stem.example.com). Workers on the same Cloudflare account
// as stem should also bind it as STEM, so the key directory is fetched without the public hostname.

const DIRECTORY = "/.well-known/private-token-issuer-directory";
const TOKEN_TYPE = 2;
const TOKEN_BYTES = 2 + 32 + 32 + 32 + 256;
const enc = (s) => new TextEncoder().encode(s);

export const b64u = (b) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const unb64u = (s) => {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not base64url");
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
};
const sha256 = async (b) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function passIssuer(env) {
  try {
    const u = new URL(env.PASS_ISSUER || "");
    return u.protocol === "https:" || u.hostname === "localhost" ? u.origin : null;
  } catch {
    return null;
  }
}

/** TokenChallenge (RFC 9577, section 2.1): this site, this issuer, no redemption context, so passes can be fetched ahead. */
export function challenge(issuerHost, originHost) {
  const iss = enc(issuerHost), org = enc(originHost);
  const out = new Uint8Array(2 + 2 + iss.length + 1 + 2 + org.length);
  const v = new DataView(out.buffer);
  let i = 0;
  v.setUint16(i, TOKEN_TYPE); i += 2;
  v.setUint16(i, iss.length); i += 2; out.set(iss, i); i += iss.length;
  out[i++] = 0;
  v.setUint16(i, org.length); i += 2; out.set(org, i);
  return out;
}

/** Modulus and exponent of an RSA SubjectPublicKeyInfo, as a JWK WebCrypto can import. */
export function tokenKeyJwk(spki) {
  const read = (at) => {
    let len = spki[at + 1], start = at + 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      if (n < 1 || n > 2) throw new Error("bad key");
      len = 0;
      for (let k = 0; k < n; k++) len = (len << 8) | spki[start + k];
      start += n;
    }
    if (start + len > spki.length) throw new Error("bad key");
    return { tag: spki[at], start, end: start + len };
  };
  const outer = read(0), alg = read(outer.start), bits = read(alg.end);
  if (outer.tag !== 0x30 || bits.tag !== 0x03 || spki[bits.start] !== 0) throw new Error("bad key");
  const seq = read(bits.start + 1), n = read(seq.start), e = read(n.end);
  if (n.tag !== 0x02 || e.tag !== 0x02) throw new Error("bad key");
  let nb = spki.slice(n.start, n.end);
  while (nb[0] === 0) nb = nb.slice(1);
  if (nb.length !== 256) throw new Error("expected RSA-2048");
  return { kty: "RSA", n: b64u(nb), e: b64u(spki.slice(e.start, e.end)), alg: "PS384", ext: true };
}

// ---------------------------------------------------------------- the issuer's keys

const cache = { at: 0, refreshAt: 0, keys: null };
/** Forgets the cached keys (tests switch issuers). */
export const resetPassKeys = () => Object.assign(cache, { at: 0, refreshAt: 0, keys: null });
const TTL = 5 * 60 * 1000;

async function fetchDirectory(env) {
  const url = passIssuer(env) + DIRECTORY;
  const r = env.STEM ? await env.STEM.fetch(new Request(url)) : await fetch(url, { cf: { cacheTtl: 60 } });
  if (!r.ok) throw new Error("issuer directory: HTTP " + r.status);
  const d = await r.json();
  const keys = new Map();
  const raw = [];
  for (const k of d["token-keys"] || []) {
    if (k["token-type"] !== TOKEN_TYPE) continue;
    const spki = unb64u(k["token-key"]);
    const id = b64u(await sha256(spki));
    const key = await crypto.subtle.importKey("jwk", tokenKeyJwk(spki), { name: "RSA-PSS", hash: "SHA-384" }, false, ["verify"]);
    keys.set(id, { key, notAfter: +k["stem-not-after"] || 0 });
    raw.push({ id, tokenKey: k["token-key"] });
  }
  return { keys, raw, requestUri: d["issuer-request-uri"], perDay: d["stem-per-day"] || null };
}

/** The issuer's current keys, newest first. `fresh` refetches, at most once a minute. */
export async function issuerKeys(env, fresh = false) {
  const t = Date.now();
  if (cache.keys && t - cache.at < TTL && !(fresh && t > cache.refreshAt)) return cache.keys;
  const p = fetchDirectory(env).then((d) => { cache.at = Date.now(); cache.keys = d; return d; });
  cache.refreshAt = t + 60 * 1000;
  try {
    return await p;
  } catch (e) {
    if (cache.keys) return cache.keys; // keep working on the last good keys if the issuer is briefly away
    throw e;
  }
}

/** What the page needs to fetch passes: where to ask, the key and the challenge to bind them to. */
export async function passConfig(env, url) {
  const issuer = passIssuer(env);
  if (!issuer) return null;
  const d = await issuerKeys(env);
  const current = d.raw[0];
  if (!current) return null;
  return {
    issuer,
    request_uri: d.requestUri || issuer + "/api/passes/issue",
    sign_in: `${issuer}/sign-in?next=${encodeURIComponent(`/passes/back?to=${encodeURIComponent(url.origin + "/?passes=1")}`)}`,
    challenge: b64u(challenge(new URL(issuer).host, url.hostname)),
    token_key: current.tokenKey,
    token_key_id: current.id,
    accepted_key_ids: d.raw.map((k) => k.id),
    per_day: d.perDay,
  };
}

// ---------------------------------------------------------------- checking a pass

/** The pass in `Authorization: PrivateToken token="..."` (RFC 9577, section 2.2), or null. */
export function readPass(req) {
  const h = req.headers.get("authorization") || "";
  const m = /^PrivateToken\s+token="?([A-Za-z0-9_-]{1,600})"?\s*$/i.exec(h);
  return m ? m[1] : h ? "" : null;
}

/**
 * Checks a pass for this site: format, binding to our challenge, a key the issuer lists and its signature.
 * Returns { ok, keyId, nonce } or { ok: false, reason }. Doesn't spend it.
 */
export async function checkPass(env, url, token) {
  let b;
  try { b = unb64u(token); } catch { return { ok: false, reason: "malformed" }; }
  if (b.length !== TOKEN_BYTES || ((b[0] << 8) | b[1]) !== TOKEN_TYPE) return { ok: false, reason: "malformed" };
  const issuer = passIssuer(env);
  if (!same(b.subarray(34, 66), await sha256(challenge(new URL(issuer).host, url.hostname)))) return { ok: false, reason: "other-site" };
  const keyId = b64u(b.subarray(66, 98));
  let k = (await issuerKeys(env)).keys.get(keyId);
  if (!k) k = (await issuerKeys(env, true)).keys.get(keyId);
  if (!k || (k.notAfter && k.notAfter * 1000 < Date.now())) return { ok: false, reason: "expired" };
  const ok = await crypto.subtle.verify({ name: "RSA-PSS", saltLength: 48 }, k.key, b.subarray(98), b.subarray(0, 98));
  return ok ? { ok: true, keyId, nonce: b64u(b.subarray(2, 34)) } : { ok: false, reason: "bad-signature" };
}

/**
 * Checks and spends the pass on a request. null: the request has none. Otherwise { ok } or { ok: false, reason }.
 * A pass counts once, across all of convert: one Durable Object per issuer key holds the spent nonces.
 */
export async function spendPass(req, env, url) {
  const token = readPass(req);
  if (token === null) return null;
  if (!passIssuer(env) || !env.SPENT) return { ok: false, reason: "off" };
  if (!token) return { ok: false, reason: "malformed" };
  let c;
  try {
    c = await checkPass(env, url, token);
  } catch (e) {
    console.error("pass check failed", e);
    return { ok: false, reason: "unavailable" };
  }
  if (!c.ok) return c;
  const r = await env.SPENT.get(env.SPENT.idFromName(c.keyId)).fetch("https://spent/" + c.nonce, { method: "POST" });
  return r.status === 201 ? { ok: true } : { ok: false, reason: "spent" };
}

/**
 * Spent passes of one issuer key. A pass's key is in the issuer's directory for two days at most,
 * so three days after the first pass the whole list goes.
 */
export class SpentPasses {
  constructor(state) {
    this.state = state;
    state.storage.sql.exec("CREATE TABLE IF NOT EXISTS spent (nonce TEXT PRIMARY KEY, at INTEGER NOT NULL)");
  }
  async fetch(req) {
    const nonce = new URL(req.url).pathname.slice(1);
    if (req.method !== "POST" || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) return new Response(null, { status: 400 });
    // RETURNING tells "inserted" from "already there" (rowsWritten also counts the index write).
    const fresh = this.state.storage.sql.exec("INSERT INTO spent (nonce, at) VALUES (?, ?) ON CONFLICT(nonce) DO NOTHING RETURNING nonce", nonce, Date.now()).toArray().length === 1;
    if (fresh && !(await this.state.storage.getAlarm())) await this.state.storage.setAlarm(Date.now() + 3 * 86400 * 1000);
    return new Response(null, { status: fresh ? 201 : 409 });
  }
  async alarm() {
    await this.state.storage.deleteAll();
    this.state.storage.sql.exec("CREATE TABLE IF NOT EXISTS spent (nonce TEXT PRIMARY KEY, at INTEGER NOT NULL)");
  }
}
