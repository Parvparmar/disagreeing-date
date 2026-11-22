ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS children_preference text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_children_preference,
  ADD CONSTRAINT profiles_children_preference
    CHECK (
      children_preference IS NULL
      OR children_preference IN (
        'Want children',
        'Open to children',
        'Don''t want children',
        'Not sure'
      )
    );

GRANT UPDATE (children_preference) ON public.profiles TO authenticated;

ALTER TABLE public.runner_discovery
  ADD COLUMN IF NOT EXISTS children_preference text,
  ADD COLUMN IF NOT EXISTS perspective_answers jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.runner_discovery
  DROP CONSTRAINT IF EXISTS runner_discovery_children_preference,
  ADD CONSTRAINT runner_discovery_children_preference
    CHECK (
      children_preference IS NULL
      OR children_preference IN (
        'Want children',
        'Open to children',
        'Don''t want children',
        'Not sure'
      )
    );

CREATE TABLE IF NOT EXISTS public.perspective_answers (
  user_id uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  question_id text NOT NULL,
  score numeric(4, 3) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id),
  CONSTRAINT perspective_answer_question_id
    CHECK (char_length(btrim(question_id)) BETWEEN 1 AND 120),
  CONSTRAINT perspective_answer_score
    CHECK (score BETWEEN -1 AND 1)
);

ALTER TABLE public.perspective_answers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.runner_discovery
  DROP CONSTRAINT IF EXISTS runner_discovery_perspective_answers_object,
  ADD CONSTRAINT runner_discovery_perspective_answers_object
    CHECK (jsonb_typeof(perspective_answers) = 'object');

DROP POLICY IF EXISTS "Signed-in users can read perspective answers" ON public.perspective_answers;
CREATE POLICY "Signed-in users can read perspective answers"
  ON public.perspective_answers FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON public.perspective_answers FROM anon, authenticated;
GRANT SELECT ON public.perspective_answers TO authenticated;

CREATE OR REPLACE FUNCTION public.save_my_perspective_answer(
  p_question_id text,
  p_score numeric
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

  IF p_question_id IS NULL
    OR btrim(p_question_id) = ''
    OR p_score IS NULL
    OR p_score NOT BETWEEN -1 AND 1
  THEN
    RAISE EXCEPTION 'A valid perspective question and score are required.';
  END IF;

  INSERT INTO public.perspective_answers (
    user_id,
    question_id,
    score,
    updated_at
  )
  VALUES (
    user_id_value,
    btrim(p_question_id),
    round(p_score, 3),
    now()
  )
  ON CONFLICT (user_id, question_id) DO UPDATE
  SET score = EXCLUDED.score,
      updated_at = now();

  UPDATE public.runner_discovery
  SET perspective_answers = (
    SELECT jsonb_object_agg(question_id, score)
    FROM public.perspective_answers
    WHERE user_id = user_id_value
  ),
  updated_at = now()
  WHERE user_id = user_id_value;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Discovery profile not found.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_my_perspective_answer(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_perspective_answer(text, numeric) TO authenticated;

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
BEGIN
  display_name_value := btrim(COALESCE(NEW.raw_user_meta_data ->> 'display_name', ''));
  birth_date_text := NEW.raw_user_meta_data ->> 'birth_date';
  intention_value := COALESCE(NEW.raw_user_meta_data ->> 'intention', 'Friends');
  children_preference_value := NEW.raw_user_meta_data ->> 'children_preference';

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

  INSERT INTO public.profiles (
    user_id,
    display_name,
    birth_date,
    intention,
    children_preference
  )
  VALUES (
    NEW.id,
    display_name_value,
    birth_date_value,
    intention_value,
    children_preference_value
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
    updated_at
  )
  VALUES (
    NEW.user_id,
    NEW.display_name,
    NEW.intention,
    NEW.children_preference,
    NEW.city,
    NEW.neighborhood,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      intention = EXCLUDED.intention,
      children_preference = EXCLUDED.children_preference,
      city = EXCLUDED.city,
      neighborhood = EXCLUDED.neighborhood,
      updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_runner_discovery_profile ON public.profiles;
CREATE TRIGGER sync_runner_discovery_profile
  AFTER INSERT OR UPDATE OF display_name, intention, children_preference, city, neighborhood
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_runner_discovery_profile();

UPDATE public.runner_discovery AS discovery
SET children_preference = profile.children_preference,
    updated_at = now()
FROM public.profiles AS profile
WHERE discovery.user_id = profile.user_id
  AND discovery.children_preference IS DISTINCT FROM profile.children_preference;

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
      children_preference = p_profile ->> 'children_preference',
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
