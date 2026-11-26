import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { phAi, phCapture, phException, phKey, phProxy, phScriptTag } from "../src/posthog.ts";

const KEY = "phc_testtoken1234567890";
const env = { POSTHOG_KEY: KEY };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("ok", { headers: { "set-cookie": "ph=1" } });
  }) as typeof fetch;
  return calls;
}

test("off without a valid project token", async () => {
  const calls = stubFetch();
  assert.equal(phKey({}), null);
  assert.equal(phScriptTag({}), "");
  assert.equal(phScriptTag(env), '<script src="/_sb/init.js" defer></script>');
  await phCapture({}, null, "x");
  await phException({}, null, new Error("boom"));
  assert.equal(await phAi({}, null, { model: "m" }, async () => 7), 7);
  assert.equal(calls.length, 0);
});

test("proxy routes hosts and never forwards cookies or foreign bearer tokens", async () => {
  const calls = stubFetch();
  const req = (path: string, init: RequestInit = {}) => new Request(`https://convert.test${path}`, init);
  assert.equal(await phProxy(req("/png-to-webp"), env), null);
  assert.equal((await phProxy(req("/_sb/e/"), {}))!.status, 404);
  await phProxy(req("/_sb/static/array.js"), env);
  const res = await phProxy(req("/_sb/e/", { method: "POST", body: "{}", headers: { cookie: "a=b", authorization: "Bearer other", "cf-connecting-ip": "203.0.113.9" } }), env);
  assert.equal(calls[0].url, "https://us-assets.i.posthog.com/static/array.js");
  assert.equal(calls[1].url, "https://us.i.posthog.com/e/");
  const h = new Headers(calls[1].init.headers);
  assert.equal(h.get("cookie"), null);
  assert.equal(h.get("authorization"), null);
  assert.equal(h.get("x-forwarded-for"), "203.0.113.9");
  assert.equal(res!.headers.get("set-cookie"), null);
});

test("init.js masks job paths, queries and attributes", async () => {
  const res = await phProxy(new Request("https://convert.test/_sb/init.js"), env, { app: "convert", keep: /^\/(png-to-webp|privacy)?$/ });
  const win: any = { URL };
  win.window = win;
  win.document = { createElement: () => ({}), getElementsByTagName: () => [{ parentNode: { insertBefore() {} } }] };
  win.location = { origin: "https://convert.test" };
  runInNewContext(await res!.text(), win);
  const [token, cfg] = win.posthog._i[0];
  assert.equal(token, KEY);
  assert.equal(cfg.cookieless_mode, "always");
  assert.equal(cfg.disable_session_recording, true);
  const ev = cfg.before_send({ event: "$autocapture", properties: { $current_url: "https://convert.test/api/jobs/0b6f0a39-2a39-4a0f-9a4b-5c0b6a3e8f11/download?x=1", $pathname: "/png-to-webp", $elements_chain: 'a.dl:attr__href="blob:https://convert.test/x"attr__download="holiday.mov"nth-child="2"' } });
  assert.equal(ev.properties.$current_url, "https://convert.test/[private]");
  assert.equal(ev.properties.$pathname, "/png-to-webp");
  assert.equal(ev.properties.$elements_chain, 'a.dl:nth-child="2"');
  assert.equal(ev.properties.app, "convert");
});

test("server events carry no IP or person profile; exceptions mask long strings", async () => {
  const calls = stubFetch();
  await phCapture(env, null, "image_converted", { format: "webp" });
  await phException(env, null, new Error("job 0b6f0a39-2a39-4a0f-9a4b-5c0b6a3e8f11 failed"));
  const a = JSON.parse(String(calls[0].init.body)).batch[0];
  assert.equal(a.properties.$process_person_profile, false);
  assert.equal(a.properties.$geoip_disable, true);
  const b = JSON.parse(String(calls[1].init.body)).batch[0];
  assert.equal(b.properties.$exception_list[0].value, "job [masked] failed");
});
