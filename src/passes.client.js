// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 shiftbloom studio and contributors
//
// Browser side of passes (see passes.js): fetch a batch of Privacy Pass tokens from stem and keep
// them in this site's local storage. Each pass is blinded here before it goes to stem (RSA blind
// signatures, RFC 9474, as used by RFC 9578), so stem signs it without seeing it and can't recognize
// it when convert checks it. No dependencies: WebCrypto for hashes and randomness, BigInt for RSA.
(() => {
  const STORE = "convert.passes.v1";
  const enc = (s) => new TextEncoder().encode(s);
  const b64u = (b) => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const digest = async (alg, b) => new Uint8Array(await crypto.subtle.digest(alg, b));
  const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
  const toInt = (b) => { let h = ""; for (const x of b) h += x.toString(16).padStart(2, "0"); return BigInt("0x" + (h || "0")); };
  const toBytes = (n, len) => { const h = n.toString(16).padStart(len * 2, "0"); const o = new Uint8Array(len); for (let i = 0; i < len; i++) o[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return o; };
  const modPow = (b, e, m) => { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; };
  const modInv = (a, m) => { let [r0, r1, s0, s1] = [m, a % m, 0n, 1n]; while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; } if (r0 !== 1n) throw new Error("not invertible"); return ((s0 % m) + m) % m; };

  /** Modulus and exponent from the issuer's key (an RSA SubjectPublicKeyInfo). */
  function rsaKey(spki) {
    const read = (at) => { let len = spki[at + 1], start = at + 2; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let k = 0; k < n; k++) len = (len << 8) | spki[start + k]; start += n; } return { start, end: start + len }; };
    const outer = read(0), alg = read(outer.start), bits = read(alg.end), seq = read(bits.start + 1), n = read(seq.start), e = read(n.end);
    return { n: toInt(spki.subarray(n.start, n.end)), e: toInt(spki.subarray(e.start, e.end)) };
  }

  /** EMSA-PSS-ENCODE (RFC 8017, 9.1.1) with SHA-384, MGF1-SHA-384 and a 48-byte salt, for a 2048-bit key. */
  async function pssEncode(msg) {
    const emLen = 256, hLen = 48, sLen = 48;
    const mHash = await digest("SHA-384", msg);
    const salt = crypto.getRandomValues(new Uint8Array(sLen));
    const h = await digest("SHA-384", cat(new Uint8Array(8), mHash, salt));
    const db = cat(new Uint8Array(emLen - sLen - hLen - 2), Uint8Array.of(1), salt);
    const mask = new Uint8Array(db.length);
    for (let c = 0, i = 0; i < mask.length; c++) {
      const block = await digest("SHA-384", cat(h, Uint8Array.of(c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255)));
      for (let j = 0; j < block.length && i < mask.length; j++) mask[i++] = block[j];
    }
    for (let i = 0; i < db.length; i++) db[i] ^= mask[i];
    db[0] &= 0x7f; // emBits = 2047
    return cat(db, h, Uint8Array.of(0xbc));
  }

  /** One token request: the token input, blinded (RSABSSA-SHA384-PSS-Deterministic, RFC 9474, 4.2). */
  async function blind(cfg) {
    const spki = unb64u(cfg.token_key);
    const keyId = await digest("SHA-256", spki);
    const { n, e } = rsaKey(spki);
    const input = cat(Uint8Array.of(0, 2), crypto.getRandomValues(new Uint8Array(32)), await digest("SHA-256", unb64u(cfg.challenge)), keyId);
    const m = toInt(await pssEncode(input));
    for (;;) {
      // Uniform in [2, n): rejection sampling, no modulo bias.
      const r = toInt(crypto.getRandomValues(new Uint8Array(256)));
      if (r < 2n || r >= n) continue;
      let inv;
      try { inv = modInv(r, n); } catch { continue; }
      const z = (m * modPow(r, e, n)) % n;
      return { request: cat(Uint8Array.of(0, 2, keyId[31]), toBytes(z, 256)), input, m, inv, n, e };
    }
  }

  /** Unblinds stem's answer and checks it: s^e mod n must give back exactly what was blinded. */
  function finalize(b, response) {
    const s = (toInt(unb64u(response)) * b.inv) % b.n;
    if (modPow(s, b.e, b.n) !== b.m) throw new Error("bad signature from the issuer");
    return b64u(cat(b.input, toBytes(s, 256)));
  }

  // ---------------------------------------------------------------- storage

  let cfg = null;
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || "[]"); } catch { return []; } };
  const save = (list) => { try { localStorage.setItem(STORE, JSON.stringify(list)); } catch {} };
  /** Passes for keys convert still accepts. */
  const usable = () => {
    const ok = new Set(cfg ? cfg.accepted_key_ids : []);
    const list = load();
    const keep = list.filter((p) => ok.has(p.k));
    if (cfg && keep.length !== list.length) save(keep);
    return keep;
  };

  async function config() {
    if (!cfg) {
      const r = await fetch("/api/passes/config", { cache: "no-store" });
      cfg = r.ok ? await r.json() : false;
    }
    return cfg || null;
  }

  /**
   * Fetches up to `n` passes from stem. Returns { added } or { signIn: url } when there's no stem session,
   * or { error } with stem's message.
   */
  async function refill(n = 50) {
    const c = await config();
    if (!c) return { error: "Passes aren't available here." };
    const batch = await Promise.all(Array.from({ length: Math.min(50, Math.max(1, n)) }, () => blind(c)));
    const r = await fetch(c.request_uri, {
      method: "POST", credentials: "include", cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token_key_id: c.token_key_id, requests: batch.map((b) => b64u(b.request)) }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) return { signIn: c.sign_in };
    if (!r.ok) return { error: j.message || "stem didn't hand out passes right now.", remaining: j.remaining };
    const fresh = [];
    for (let i = 0; i < (j.responses || []).length; i++) {
      try { fresh.push({ t: finalize(batch[i], j.responses[i]), k: c.token_key_id }); } catch {}
    }
    save(usable().concat(fresh));
    return { added: fresh.length, remaining: j.remaining };
  }

  /** Takes one pass out of storage, or null. */
  function take() {
    const list = usable();
    const p = list.shift();
    save(list);
    return p ? p.t : null;
  }

  /** Puts a pass back that the server didn't keep (it refused the request for everyone, see unspendPass). */
  function giveBack(t) {
    if (!t) return;
    try { save([{ t, k: b64u(unb64u(t).subarray(66, 98)) }].concat(load())); } catch {}
  }

  globalThis.convertPasses = { config, refill, take, giveBack, count: () => usable().length, _blind: blind, _finalize: finalize };
})();
