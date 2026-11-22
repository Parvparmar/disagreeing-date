ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS gender_preference text NOT NULL DEFAULT 'both';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_gender,
  ADD CONSTRAINT profiles_gender
    CHECK (gender IS NULL OR gender IN ('male', 'female')),
  DROP CONSTRAINT IF EXISTS profiles_gender_preference,
  ADD CONSTRAINT profiles_gender_preference
    CHECK (gender_preference IN ('male', 'female', 'both'));

ALTER TABLE public.runner_discovery
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS gender_preference text NOT NULL DEFAULT 'both';

ALTER TABLE public.runner_discovery
  DROP CONSTRAINT IF EXISTS runner_discovery_gender,
  ADD CONSTRAINT runner_discovery_gender
    CHECK (gender IS NULL OR gender IN ('male', 'female')),
  DROP CONSTRAINT IF EXISTS runner_discovery_gender_preference,
  ADD CONSTRAINT runner_discovery_gender_preference
    CHECK (gender_preference IN ('male', 'female', 'both'));

GRANT UPDATE (gender, gender_preference) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.create_profile_for_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  display_name_value text;
  birth_date_text text;
  birth_date_value date;
  intention_value text;
  children_preference_value text;
  gender_value text;
  gender_preference_value text;
BEGIN
  display_name_value := btrim(COALESCE(NEW.raw_user_meta_data ->> 'display_name', ''));
  birth_date_text := NEW.raw_user_meta_data ->> 'birth_date';
  intention_value := COALESCE(NEW.raw_user_meta_data ->> 'intention', 'Dating');
  children_preference_value := NEW.raw_user_meta_data ->> 'children_preference';
  gender_value := NEW.raw_user_meta_data ->> 'gender';
  gender_preference_value := NEW.raw_user_meta_data ->> 'gender_preference';

  IF char_length(display_name_value) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'A display name between 1 and 60 characters is required.';
  END IF;

  IF birth_date_text IS NULL OR birth_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'A valid date of birth is required.';
  END IF;

  BEGIN
    birth_date_value := birth_date_text::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'A valid date of birth is required.';
  END;

  IF birth_date_value > (CURRENT_DATE - INTERVAL '18 years')::date THEN
    RAISE EXCEPTION 'PaceMate is for adults 18 and older.';
  END IF;

  IF intention_value <> 'Dating' THEN
    RAISE EXCEPTION 'A valid discovery intention is required.';
  END IF;

  IF children_preference_value IS NOT NULL
    AND children_preference_value NOT IN (
      'Want children',
      'Open to children',
      'Don''t want children',
      'Not sure'
    )
  THEN
    RAISE EXCEPTION 'A valid children preference is required.';
  END IF;

  IF gender_value IS NULL OR gender_value NOT IN ('male', 'female') THEN
    RAISE EXCEPTION 'A valid gender is required.';
  END IF;

  IF gender_preference_value IS NULL
    OR gender_preference_value NOT IN ('male', 'female', 'both')
  THEN
    RAISE EXCEPTION 'A valid gender preference is required.';
  END IF;

  INSERT INTO public.profiles (
    user_id,
    display_name,
    birth_date,
    intention,
    children_preference,
    gender,
    gender_preference
  )
  VALUES (
    NEW.id,
    display_name_value,
    birth_date_value,
    intention_value,
    children_preference_value,
    gender_value,
    gender_preference_value
  );

  INSERT INTO public.running_preferences (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$;

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
    children_preference,
    city,
    neighborhood,
    photo_url,
    is_demo,
    gender,
    gender_preference,
    updated_at
  )
  VALUES (
    NEW.user_id,
    NEW.display_name,
    NEW.intention,
    NEW.children_preference,
    NEW.city,
    NEW.neighborhood,
    NEW.photo_url,
    NEW.is_demo,
    NEW.gender,
    NEW.gender_preference,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      intention = EXCLUDED.intention,
      children_preference = EXCLUDED.children_preference,
      city = EXCLUDED.city,
      neighborhood = EXCLUDED.neighborhood,
      photo_url = EXCLUDED.photo_url,
      is_demo = EXCLUDED.is_demo,
      gender = EXCLUDED.gender,
      gender_preference = EXCLUDED.gender_preference,
      updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_runner_discovery_profile ON public.profiles;
CREATE TRIGGER sync_runner_discovery_profile
  AFTER INSERT OR UPDATE OF display_name, intention, children_preference,
    city, neighborhood, photo_url, is_demo, gender, gender_preference
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_runner_discovery_profile();

UPDATE public.runner_discovery AS discovery
SET gender = profile.gender,
    gender_preference = profile.gender_preference,
    updated_at = now()
FROM public.profiles AS profile
WHERE discovery.user_id = profile.user_id
  AND (
    discovery.gender IS DISTINCT FROM profile.gender
    OR discovery.gender_preference IS DISTINCT FROM profile.gender_preference
  );

CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_profile jsonb,
  p_preferences jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  user_id_value uuid := (SELECT auth.uid());
  gender_value text := p_profile ->> 'gender';
  gender_preference_value text := p_profile ->> 'gender_preference';
BEGIN
  IF user_id_value IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  IF gender_value IS NULL OR gender_value NOT IN ('male', 'female') THEN
    RAISE EXCEPTION 'A valid gender is required.';
  END IF;

  IF gender_preference_value IS NULL
    OR gender_preference_value NOT IN ('male', 'female', 'both')
  THEN
    RAISE EXCEPTION 'A valid gender preference is required.';
  END IF;

  UPDATE public.profiles
  SET display_name = btrim(p_profile ->> 'display_name'),
      intention = p_profile ->> 'intention',
      children_preference = p_profile ->> 'children_preference',
      city = NULLIF(btrim(p_profile ->> 'city'), ''),
      neighborhood = NULLIF(btrim(p_profile ->> 'neighborhood'), ''),
      gender = gender_value,
      gender_preference = gender_preference_value,
      updated_at = now()
  WHERE user_id = user_id_value;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  UPDATE public.running_preferences
  SET easy_pace_seconds_per_km =
        (p_preferences ->> 'easy_pace_seconds_per_km')::integer,
      preferred_distance_km =
        (p_preferences ->> 'preferred_distance_km')::numeric,
      preferred_days = ARRAY(
        SELECT jsonb_array_elements_text(p_preferences -> 'preferred_days')
      ),
      preferred_time = p_preferences ->> 'preferred_time',
      runs_per_week = (p_preferences ->> 'runs_per_week')::smallint,
      updated_at = now()
  WHERE user_id = user_id_value;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Running preferences not found.';
  END IF;
END;
$$;
