-- GA4 response cache table
-- Used by the ga4-query_affiliates edge function to serve cached results
-- and avoid hitting the GA4 API on every dashboard load.
--
-- Access model:
--   Only the edge function (via SUPABASE_SERVICE_ROLE_KEY) reads/writes this table.
--   Service role bypasses RLS entirely. The deny_all policy blocks all other roles.
--   There is no reason for anon or authenticated users to read raw GA4 cache rows.

CREATE TABLE IF NOT EXISTS ga4_cache (
  cache_key   TEXT        PRIMARY KEY,
  page        TEXT        NOT NULL,
  property_id TEXT        NOT NULL,
  reports     JSONB       NOT NULL,
  cached_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Fast lookups by expiry (used by cleanup queries in the warmer function)
CREATE INDEX IF NOT EXISTS ga4_cache_expires_idx ON ga4_cache (expires_at);
-- Fast lookups by property (used during warming)
CREATE INDEX IF NOT EXISTS ga4_cache_property_idx ON ga4_cache (property_id, page);

-- RLS: deny all non-service-role access
ALTER TABLE ga4_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON ga4_cache USING (false);
