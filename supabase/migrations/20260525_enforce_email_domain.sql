-- ─────────────────────────────────────────────────────────────────────────────
-- Auth Hook: email domain restriction
-- Uses Supabase's native "Auth Hook" feature (no auth schema permissions needed)
-- Function lives in public schema and is registered via the Dashboard.
--
-- HOW TO APPLY:
--   1. Run this SQL in the Supabase SQL Editor (as postgres)
--   2. Then register the hook in the Dashboard — see instructions at the bottom
-- ─────────────────────────────────────────────────────────────────────────────

-- The hook function receives the signup event as JSONB and must return JSONB.
-- Returning an object with an "error" key aborts the signup with a 422.

CREATE OR REPLACE FUNCTION public.check_email_domain(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  email_addr text;
BEGIN
  -- Extract the email from the hook event payload
  email_addr := event ->> 'email';

  -- Allow NULL (phone-only signups) through unmodified
  IF email_addr IS NULL THEN
    RETURN event;
  END IF;

  -- ILIKE: case-insensitive match
  IF email_addr NOT ILIKE '%@elifetransfer.com' THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 422,
        'message',   'Access is restricted to @elifetransfer.com accounts only.'
      )
    );
  END IF;

  -- Email is valid — return the event unchanged to allow signup to proceed
  RETURN event;
END;
$$;

-- Grant execute to supabase_auth_admin so Supabase can call it
GRANT EXECUTE ON FUNCTION public.check_email_domain(jsonb) TO supabase_auth_admin;

-- ─────────────────────────────────────────────────────────────────────────────
-- DASHBOARD REGISTRATION (required after running the SQL above)
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Go to: Authentication → Hooks  (in your Supabase project dashboard)
-- 2. Click "Add hook"
-- 3. Hook type:  "Before signup"  (fires before any user is created)
-- 4. Hook backend: "Postgres function"
-- 5. Schema:    public
-- 6. Function:  check_email_domain
-- 7. Click Save
--
-- After this, ALL signup paths (email/password, Google OAuth, magic link)
-- will be rejected with 422 if the email is not @elifetransfer.com,
-- even if called directly against the Supabase API — no frontend bypass possible.
-- ─────────────────────────────────────────────────────────────────────────────
