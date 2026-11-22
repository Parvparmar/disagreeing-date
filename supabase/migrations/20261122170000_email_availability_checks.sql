CREATE TABLE IF NOT EXISTS public.email_availability_checks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_hash text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_availability_checks_client_time_idx
  ON public.email_availability_checks (client_hash, checked_at DESC);
CREATE INDEX IF NOT EXISTS email_availability_checks_checked_at_idx
  ON public.email_availability_checks (checked_at);

ALTER TABLE public.email_availability_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_availability_checks FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_signup_email_availability(
  p_email text,
  p_client_hash text
)
RETURNS TABLE (
  is_available boolean,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_email text := lower(btrim(p_email));
  request_count integer;
  first_request timestamptz;
BEGIN
  IF p_email IS NULL
    OR p_client_hash IS NULL
    OR normalized_email = ''
    OR length(normalized_email) > 320
    OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR p_client_hash !~ '^[a-f0-9]{64}$'
  THEN
    RAISE EXCEPTION 'Invalid email availability request.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_hash, 0));

  DELETE FROM public.email_availability_checks AS check_record
  WHERE check_record.checked_at < now() - interval '1 hour';

  SELECT count(*)::integer, min(check_record.checked_at)
  INTO request_count, first_request
  FROM public.email_availability_checks AS check_record
  WHERE check_record.client_hash = p_client_hash
    AND check_record.checked_at >= now() - interval '1 hour';

  IF request_count >= 20 THEN
    RETURN QUERY
    SELECT
      false,
      greatest(
        1,
        ceil(extract(epoch FROM (first_request + interval '1 hour' - now())))::integer
      );
    RETURN;
  END IF;

  INSERT INTO public.email_availability_checks (client_hash)
  VALUES (p_client_hash);

  RETURN QUERY
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM auth.users AS auth_user
      WHERE lower(auth_user.email) = normalized_email
    ),
    NULL::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.check_signup_email_availability(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_signup_email_availability(text, text)
  TO service_role;
