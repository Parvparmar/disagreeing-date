CREATE TABLE public.runner_discovery (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  display_name text NOT NULL,
  intention text NOT NULL,
  city text,
  neighborhood text,
  total_distance_km numeric(10, 2),
  run_count integer,
  median_distance_km numeric(7, 2),
  median_pace_seconds_per_km integer,
  runs_per_week numeric(7, 2),
  preferred_days text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runner_discovery_intention
    CHECK (intention IN ('Friends', 'Dating', 'Both')),
  CONSTRAINT runner_discovery_total_distance
    CHECK (total_distance_km IS NULL OR total_distance_km > 0),
  CONSTRAINT runner_discovery_run_count
    CHECK (run_count IS NULL OR run_count > 0),
  CONSTRAINT runner_discovery_median_distance
    CHECK (median_distance_km IS NULL OR median_distance_km > 0),
  CONSTRAINT runner_discovery_pace
    CHECK (
      median_pace_seconds_per_km IS NULL
      OR median_pace_seconds_per_km BETWEEN 30 AND 7200
    ),
  CONSTRAINT runner_discovery_frequency
    CHECK (runs_per_week IS NULL OR runs_per_week BETWEEN 0 AND 10000),
  CONSTRAINT runner_discovery_days
    CHECK (
      preferred_days IS NULL
      OR (
        preferred_days <@ ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']::text[]
        AND cardinality(preferred_days) <= 7
      )
    ),
  CONSTRAINT runner_discovery_fingerprint_complete
    CHECK (
      num_nonnulls(
        total_distance_km,
        run_count,
        median_distance_km,
        runs_per_week,
        preferred_days
      ) IN (0, 5)
    ),
  CONSTRAINT runner_discovery_optional_pace
    CHECK (
      median_pace_seconds_per_km IS NULL
      OR run_count IS NOT NULL
    )
);

ALTER TABLE public.runner_discovery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed-in users can read discovery profiles"
  ON public.runner_discovery FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON public.runner_discovery FROM anon, authenticated;
GRANT SELECT ON public.runner_discovery TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_runner_discovery_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.runner_discovery (
    user_id,
    display_name,
    intention,
    city,
    neighborhood,
    updated_at
  )
  VALUES (
    NEW.user_id,
    NEW.display_name,
    NEW.intention,
    NEW.city,
    NEW.neighborhood,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      intention = EXCLUDED.intention,
      city = EXCLUDED.city,
      neighborhood = EXCLUDED.neighborhood,
      updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_runner_discovery_profile() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_runner_discovery_profile
  AFTER INSERT OR UPDATE OF display_name, intention, city, neighborhood
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_runner_discovery_profile();

INSERT INTO public.runner_discovery (
  user_id,
  display_name,
  intention,
  city,
  neighborhood
)
SELECT user_id, display_name, intention, city, neighborhood
FROM public.profiles
ON CONFLICT (user_id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    intention = EXCLUDED.intention,
    city = EXCLUDED.city,
    neighborhood = EXCLUDED.neighborhood,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.save_my_running_fingerprint(
  p_total_distance_km numeric,
  p_run_count integer,
  p_median_distance_km numeric,
  p_median_pace_seconds_per_km integer,
  p_runs_per_week numeric,
  p_preferred_days text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_id_value uuid := (SELECT auth.uid());
BEGIN
  IF user_id_value IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  IF p_total_distance_km IS NULL OR p_total_distance_km <= 0
    OR p_run_count IS NULL OR p_run_count <= 0
    OR p_median_distance_km IS NULL OR p_median_distance_km <= 0
    OR p_runs_per_week IS NULL OR p_runs_per_week < 0 OR p_runs_per_week > 10000
    OR p_preferred_days IS NULL
    OR cardinality(p_preferred_days) > 7
    OR NOT (
      p_preferred_days <@ ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']::text[]
    )
    OR (
      p_median_pace_seconds_per_km IS NOT NULL
      AND p_median_pace_seconds_per_km NOT BETWEEN 30 AND 7200
    )
  THEN
    RAISE EXCEPTION 'The running fingerprint values are invalid.';
  END IF;

  UPDATE public.runner_discovery
  SET total_distance_km = round(p_total_distance_km, 2),
      run_count = p_run_count,
      median_distance_km = round(p_median_distance_km, 2),
      median_pace_seconds_per_km = p_median_pace_seconds_per_km,
      runs_per_week = round(p_runs_per_week, 2),
      preferred_days = p_preferred_days,
      updated_at = now()
  WHERE user_id = user_id_value;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Discovery profile not found.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_my_running_fingerprint()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_id_value uuid := (SELECT auth.uid());
BEGIN
  IF user_id_value IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  UPDATE public.runner_discovery
  SET total_distance_km = NULL,
      run_count = NULL,
      median_distance_km = NULL,
      median_pace_seconds_per_km = NULL,
      runs_per_week = NULL,
      preferred_days = NULL,
      updated_at = now()
  WHERE user_id = user_id_value;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Discovery profile not found.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_my_running_fingerprint(
  numeric, integer, numeric, integer, numeric, text[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_running_fingerprint(
  numeric, integer, numeric, integer, numeric, text[]
) TO authenticated;

REVOKE ALL ON FUNCTION public.clear_my_running_fingerprint() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_my_running_fingerprint() TO authenticated;
