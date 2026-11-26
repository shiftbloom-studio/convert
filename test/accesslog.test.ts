import { test } from "node:test";
import assert from "node:assert/strict";
import { logPath, requestLine } from "../src/accesslog.ts";

test("job ids and long tokens are masked", () => {
  assert.equal(logPath("/api/jobs/0b6f0a39-2a39-4a0f-9a4b-5c0b6a3e8f11/download"), "/api/jobs/:id/download");
  assert.equal(logPath("/api/jobs/0B6F0A39-2A39-4A0F-9A4B-5C0B6A3E8F11"), "/api/jobs/:id");
  assert.equal(logPath("/png-to-webp"), "/png-to-webp");
  assert.equal(logPath("/vendor/ffmpeg-core.wasm"), "/vendor/ffmpeg-core.wasm");
  assert.equal(logPath("/x/abcdefghijklmnopqrstuvwxyz0123"), "/x/:id");
});

test("only known settings and harmless headers are kept", () => {
  const req = new Request("https://convert.example/api/jobs/0b6f0a39-2a39-4a0f-9a4b-5c0b6a3e8f11/upload?format=webp&name=secret.mov&token=t0k", {
    headers: { authorization: "Bearer t0k", cookie: "s=1", referer: "https://convert.example/?x=1", "user-agent": "UA", "cf-connecting-ip": "203.0.113.1" },
  });
  const line = requestLine(req, 200, 12);
  const s = JSON.stringify(line);
  for (const secret of ["0b6f0a39", "secret.mov", "t0k", "s=1", "referer"]) assert.ok(!s.includes(secret), secret);
  assert.deepEqual(line.query, { format: "webp" });
  assert.equal(line.path, "/api/jobs/:id/upload");
  assert.equal(line.ip, "203.0.113.1");
  assert.equal(line.headers["user-agent"], "UA");
});
