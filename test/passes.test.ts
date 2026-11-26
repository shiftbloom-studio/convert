// Passes: convert's browser client and server check against Cloudflare's reference Privacy Pass library.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { publicVerif, Token, TOKEN_TYPES } from "@cloudflare/privacypass-ts";
import { challenge, checkPass, spendPass, unspendPass, passConfig, SpentPasses, b64u, unb64u, tokenKeyJwk, resetPassKeys } from "../src/passes.ts";
await import("../src/passes.client.js");
const P = globalThis.convertPasses;

const ISSUER = "https://stem.test";
const SITE = new URL("https://convert.test/api/image");
const mode = publicVerif.BlindRSAMode.PSS;

async function makeIssuer() {
  const pair = await publicVerif.Issuer.generateKey(mode, { modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1) });
  const tokenKey = await publicVerif.getPublicKeyBytes(pair.publicKey);
  return { issuer: new publicVerif.Issuer(mode, "stem.test", pair.privateKey, pair.publicKey), tokenKey, keyId: b64u(new Uint8Array(await crypto.subtle.digest("SHA-256", tokenKey))) };
}

/** A fake Durable Object namespace backed by real SQLite, with the storage API SpentPasses uses. */
function spentNamespace() {
  const objects = new Map();
  const make = () => {
    const db = new DatabaseSync(":memory:");
    let alarm = null;
    const storage = {
      sql: { exec: (q, ...p) => { const rows = /returning/i.test(q) ? db.prepare(q).all(...p) : (db.prepare(q).run(...p), []); return { toArray: () => rows }; } },
      getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; },
      deleteAll: async () => { for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) db.exec(`DROP TABLE ${name}`); alarm = null; },
    };
    const obj = new SpentPasses({ storage });
    return { obj, storage, get alarm() { return alarm; } };
  };
  return {
    objects,
    idFromName: (n) => n,
    get: (id) => { if (!objects.has(id)) objects.set(id, make()); return { fetch: (url, init) => objects.get(id).obj.fetch(new Request(url, init)) }; },
  };
}

function envFor(iss, extra = {}) {
  resetPassKeys();
  const dir = { "issuer-request-uri": ISSUER + "/api/passes/issue", "token-keys": [{ "token-type": 2, "token-key": b64u(iss.tokenKey), "not-before": 0, "stem-not-after": Date.now() / 1000 + 86400 }], "stem-per-day": 50 };
  let calls = 0;
  return { PASS_ISSUER: ISSUER, SPENT: spentNamespace(), STEM: { fetch: async () => { calls++; return Response.json(dir); } }, calls: () => calls, ...extra };
}

const ch = () => challenge("stem.test", "convert.test");

test("the challenge matches the reference library byte for byte", () => {
  const ref = new publicVerif.Origin(mode, ["convert.test"]).createTokenChallenge("stem.test", new Uint8Array(0)).serialize();
  assert.equal(b64u(ch()), b64u(ref));
});

test("convert's browser client makes passes the reference issuer signs and both verifiers accept", async () => {
  const iss = await makeIssuer();
  const cfg = { token_key: b64u(iss.tokenKey), challenge: b64u(ch()) };
  const env = envFor(iss);
  const pk = await crypto.subtle.importKey("spki", publicVerif.convertRSASSAPSSToEnc(iss.tokenKey), { name: "RSA-PSS", hash: "SHA-384" }, true, ["verify"]);
  for (let i = 0; i < 3; i++) {
    const b = await P._blind(cfg);
    assert.equal(b.request.length, 259);
    const req = publicVerif.TokenRequest.deserialize(TOKEN_TYPES.BLIND_RSA, b.request);
    const res = await iss.issuer.issue(req);
    const token = P._finalize(b, b64u(res.blindSig));
    assert.deepEqual(await checkPass(env, SITE, token), { ok: true, keyId: iss.keyId, nonce: b64u(unb64u(token).subarray(2, 34)) });
    const ref = Token.deserialize(TOKEN_TYPES.BLIND_RSA, unb64u(token));
    assert.equal(await new publicVerif.Origin(mode, ["convert.test"]).verify(ref, pk), true);
  }
  // A signature that isn't for what was blinded is refused by the client.
  const b = await P._blind(cfg);
  assert.throws(() => P._finalize(b, b64u(new Uint8Array(256).fill(7))), /bad signature/);
});

test("passes from the reference client verify, and bad ones don't", async () => {
  const iss = await makeIssuer();
  const env = envFor(iss);
  const mint = async (originHost = "convert.test") => {
    const c = new publicVerif.Client(mode);
    const tc = new publicVerif.Origin(mode, [originHost]).createTokenChallenge("stem.test", new Uint8Array(0));
    return b64u((await c.finalize(await iss.issuer.issue(await c.createTokenRequest(tc, iss.tokenKey)))).serialize());
  };
  assert.equal((await checkPass(env, SITE, await mint())).ok, true);
  assert.deepEqual(await checkPass(env, SITE, await mint("other.test")), { ok: false, reason: "other-site" });
  const t = unb64u(await mint());
  t[353] ^= 1;
  assert.deepEqual(await checkPass(env, SITE, b64u(t)), { ok: false, reason: "bad-signature" });
  assert.deepEqual(await checkPass(env, SITE, "AAAA"), { ok: false, reason: "malformed" });
  // A pass from a key the issuer doesn't list.
  const other = await makeIssuer();
  const c = new publicVerif.Client(mode);
  const foreign = b64u((await c.finalize(await other.issuer.issue(await c.createTokenRequest(new publicVerif.Origin(mode, ["convert.test"]).createTokenChallenge("stem.test", new Uint8Array(0)), other.tokenKey)))).serialize());
  assert.deepEqual(await checkPass(env, SITE, foreign), { ok: false, reason: "expired" });
});

test("a pass is spent once", async () => {
  const iss = await makeIssuer();
  const env = envFor(iss);
  const c = new publicVerif.Client(mode);
  const token = b64u((await c.finalize(await iss.issuer.issue(await c.createTokenRequest(new publicVerif.Origin(mode, ["convert.test"]).createTokenChallenge("stem.test", new Uint8Array(0)), iss.tokenKey)))).serialize());
  const req = () => new Request(SITE, { method: "POST", headers: { authorization: `PrivateToken token="${token}"` } });
  const first = await spendPass(req(), env, SITE);
  assert.equal(first.ok, true);
  assert.deepEqual(await spendPass(req(), env, SITE), { ok: false, reason: "spent" });
  assert.equal(await spendPass(new Request(SITE, { method: "POST" }), env, SITE), null);
  assert.deepEqual(await spendPass(new Request(SITE, { method: "POST", headers: { authorization: "PrivateToken nope" } }), env, SITE), { ok: false, reason: "malformed" });
  // Other schemes (a proxy's Bearer or Basic) aren't passes and are left alone.
  for (const h of ["Bearer abc", "Basic dXNlcjpwdw==", "PrivateTokenX token=abc"])
    assert.equal(await spendPass(new Request(SITE, { method: "POST", headers: { authorization: h } }), env, SITE), null);
  // Off when no issuer is configured: every request is treated as before, with or without a pass.
  assert.equal(await spendPass(req(), { ...env, PASS_ISSUER: "" }, SITE), null);
  assert.equal(await spendPass(new Request(SITE, { method: "POST", headers: { authorization: "PrivateToken nope" } }), { ...env, PASS_ISSUER: "" }, SITE), null);
  // A pass given back (the global cap refused the request) can be spent again, once.
  await unspendPass(env, first);
  assert.equal((await spendPass(req(), env, SITE)).ok, true);
  assert.deepEqual(await spendPass(req(), env, SITE), { ok: false, reason: "spent" });
  // The object forgets everything three days after its first pass.
  const o = env.SPENT.objects.get(iss.keyId);
  assert.ok(o.alarm > Date.now() + 2.9 * 86400 * 1000);
  await o.obj.alarm();
  assert.equal((await spendPass(req(), env, SITE)).ok, true);
});

test("config hands the page the newest key and the challenge for this site", async () => {
  const iss = await makeIssuer();
  const env = envFor(iss);
  const c = await passConfig(env, new URL("https://convert.test/heic-to-jpg"));
  assert.equal(c.token_key, b64u(iss.tokenKey));
  assert.equal(c.token_key_id, iss.keyId);
  assert.equal(c.challenge, b64u(ch()));
  assert.equal(c.request_uri, ISSUER + "/api/passes/issue");
  assert.equal(c.sign_in, `${ISSUER}/sign-in?next=${encodeURIComponent("/passes/back?to=" + encodeURIComponent("https://convert.test/?passes=1"))}`);
  assert.equal(await passConfig({}, SITE), null);
  assert.throws(() => tokenKeyJwk(new Uint8Array(10)));
});
