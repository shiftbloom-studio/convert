CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, engine TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, step TEXT, input_name TEXT, input_key TEXT, output_key TEXT, output_name TEXT, output_type TEXT, output_size INTEGER, stream_uid TEXT, options TEXT, error TEXT, ip_hash TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS jobs_created ON jobs(created_at);
CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, subject TEXT NOT NULL, units INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, subject));
