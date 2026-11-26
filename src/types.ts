// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 shiftbloom studio and contributors
// Bindings, variables and secrets of the Worker (see wrangler.jsonc).

export interface Env {
  FILES: R2Bucket;
  DB: D1Database;
  IMAGES: ImagesBinding;
  MEDIA: MediaBinding;
  STREAM: StreamBinding;
  CONVERT_JOB: Workflow<{ id: string }>;
  SPENT: DurableObjectNamespace;
  /** Optional service binding to a stem Worker on the same account. */
  STEM?: Fetcher;
  IMG_LIMIT: RateLimit;
  JOB_LIMIT: RateLimit;

  TURNSTILE_SITEKEY: string;
  TURNSTILE_SECRET: string;
  IMAGE_DAILY_PER_IP: string;
  IMAGE_DAILY_GLOBAL: string;
  JOB_DAILY_PER_IP: string;
  JOB_DAILY_GLOBAL: string;
  PASS_ISSUER: string;
  LEGAL_NAME: string;
  LEGAL_BUSINESS: string;
  LEGAL_STREET: string;
  LEGAL_CITY: string;
  LEGAL_COUNTRY: string;
  LEGAL_EMAIL: string;
  LEGAL_PHONE: string;
  LEGAL_VAT_ID: string;
  LEGAL_AUTHORITY: string;
}

/** The example file card at the top of a page. */
export type Example = { name: string; to: string; a: string; b: string; where: "cloud" | "local" };

/** The start page. */
export type Home = { slug: string; title: string; desc: string; h1: string; lead: string; example: Example };

/** A format landing page: the start page plus a preset target and its own article. */
export type Page = Home & {
  link: string;
  preset: { kind: "image" | "video" | "audio"; target: string; mode: "cloud" | "local" };
  h2: string;
  body: string[];
};

/** A row of the jobs table (schema.sql). */
export type Job = {
  id: string;
  kind: string;
  engine: "media" | "stream";
  status: string;
  progress: number;
  step: string | null;
  input_name: string | null;
  input_key: string | null;
  output_key: string | null;
  output_name: string | null;
  output_type: string | null;
  output_size: number | null;
  stream_uid: string | null;
  options: string | null;
  error: string | null;
  ip_hash: string;
  created_at: number;
  updated_at: number;
};
