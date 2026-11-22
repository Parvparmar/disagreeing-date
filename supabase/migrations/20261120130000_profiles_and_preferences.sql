CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text NOT NULL,
  birth_date date NOT NULL,
  intention text NOT NULL DEFAULT 'Friends',
  city text,
  neighborhood text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_display_name_length
    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 60),
  CONSTRAINT profiles_intention
    CHECK (intention IN ('Friends', 'Dating', 'Both'))
);

CREATE TABLE public.running_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  easy_pace_seconds_per_km integer NOT NULL DEFAULT 360,
  preferred_distance_km numeric(6, 2) NOT NULL DEFAULT 5,
  preferred_days text[] NOT NULL DEFAULT '{}',
  preferred_time text NOT NULL DEFAULT 'Morning',
  runs_per_week smallint NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT running_preferences_pace_range
    CHECK (easy_pace_seconds_per_km BETWEEN 180 AND 900),
  CONSTRAINT running_preferences_distance_range
    CHECK (preferred_distance_km BETWEEN 1 AND 100),
  CONSTRAINT running_preferences_days
    CHECK (
      preferred_days <@ ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']::text[]
      AND cardinality(preferred_days) <= 7
    ),
  CONSTRAINT running_preferences_time
    CHECK (preferred_time IN ('Morning', 'Afternoon', 'Evening')),
  CONSTRAINT running_preferences_weekly_frequency
    CHECK (runs_per_week BETWEEN 1 AND 7)
);

CREATE INDEX profiles_intention_idx ON public.profiles (intention);
CREATE INDEX profiles_city_neighborhood_idx
  ON public.profiles (city, neighborhood)
  WHERE city IS NOT NULL;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.running_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can read their own running preferences"
  ON public.running_preferences FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update their own running preferences"
  ON public.running_preferences FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

REVOKE INSERT, DELETE ON public.profiles FROM anon, authenticated;
REVOKE INSERT, DELETE ON public.running_preferences FROM anon, authenticated;
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (display_name, intention, city, neighborhood, updated_at)
  ON public.profiles TO authenticated;
REVOKE UPDATE ON public.running_preferences FROM anon, authenticated;
GRANT UPDATE (
  easy_pace_seconds_per_km,
  preferred_distance_km,
  preferred_days,
  preferred_time,
  runs_per_week,
  updated_at
) ON public.running_preferences TO authenticated;
GRANT SELECT ON public.profiles, public.running_preferences TO authenticated;

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
BEGIN
  display_name_value := btrim(COALESCE(NEW.raw_user_meta_data ->> 'display_name', ''));
  birth_date_text := NEW.raw_user_meta_data ->> 'birth_date';
  intention_value := COALESCE(NEW.raw_user_meta_data ->> 'intention', 'Friends');

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
    RAISE EXCEPTION 'Opinionated is for adults 18 and older.';
  END IF;

  IF intention_value NOT IN ('Friends', 'Dating', 'Both') THEN
    RAISE EXCEPTION 'A valid discovery intention is required.';
  END IF;

  INSERT INTO public.profiles (user_id, display_name, birth_date, intention)
  VALUES (NEW.id, display_name_value, birth_date_value, intention_value);

  INSERT INTO public.running_preferences (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_profile_for_new_user();

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
BEGIN
  IF user_id_value IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  UPDATE public.profiles
  SET display_name = btrim(p_profile ->> 'display_name'),
      intention = p_profile ->> 'intention',
      city = NULLIF(btrim(p_profile ->> 'city'), ''),
      neighborhood = NULLIF(btrim(p_profile ->> 'neighborhood'), ''),
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

REVOKE ALL ON FUNCTION public.update_my_profile(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile(jsonb, jsonb) TO authenticated;
