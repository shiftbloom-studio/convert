// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 shiftbloom studio and contributors
// One cleaned log line per request, written when the Worker's logs are exported (POSTHOG_LOGS set).
// Cloudflare's own invocation logs carry the full URL, and a job's URL is the link to its result,
// so the export turns them off ("invocation_logs": false) and relies on this line instead:
// job ids and other long tokens are masked, the query string is cut to a few known settings,
// and only harmless headers are kept.

const QUERY = ["format", "quality", "width"];
const HEADERS = ["user-agent", "accept-language", "content-type", "content-length"];

/** The path with job ids and anything else that looks like a token replaced by ":id". */
export function logPath(pathname: string): string {
  return pathname
    .split("/")
    .map((s) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) || (s.length > 24 && !s.includes(".")) ? ":id" : s.slice(0, 64)))
    .join("/");
}

export function requestLine(req: Request, status: number, ms: number) {
  const url = new URL(req.url);
  const cf = (req as Request & { cf?: { country?: string; colo?: string } }).cf;
  const query: Record<string, string> = {};
  for (const q of QUERY) {
    const v = url.searchParams.get(q);
    if (v) query[q] = v.slice(0, 16);
  }
  const headers: Record<string, string> = {};
  for (const h of HEADERS) {
    const v = req.headers.get(h);
    if (v) headers[h] = v.slice(0, 200);
  }
  return {
    message: "request",
    method: req.method,
    path: logPath(url.pathname),
    query,
    status,
    ms,
    ip: req.headers.get("cf-connecting-ip") || undefined,
    country: cf?.country,
    colo: cf?.colo,
    headers,
  };
}
