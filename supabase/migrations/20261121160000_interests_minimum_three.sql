UPDATE public.runner_discovery
SET interests = '{}'
WHERE cardinality(interests) BETWEEN 1 AND 2;

UPDATE public.runner_discovery
SET personality = NULL
WHERE personality IS NOT NULL;

ALTER TABLE public.runner_discovery
  DROP CONSTRAINT runner_discovery_interests,
  DROP CONSTRAINT runner_discovery_personality;

ALTER TABLE public.runner_discovery
  ADD CONSTRAINT runner_discovery_interests
    CHECK (
      (
        cardinality(interests) = 0
        OR cardinality(interests) BETWEEN 3 AND 8
      )
      AND interests <@ ARRAY[
        'Social easy runs',
        '5K/10K training',
        'Trail running',
        'Speed workouts',
        'Long runs',
        'Race preparation',
        'Coffee after a run',
        'Exploring new routes'
      ]::text[]
    );

CREATE OR REPLACE FUNCTION public.sync_runner_discovery_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  metadata jsonb;
  interests_value text[] := '{}'::text[];
  running_style_value text;
  social_style_value text;
BEGIN
  SELECT raw_user_meta_data INTO metadata
  FROM auth.users
  WHERE id = NEW.user_id;

  IF jsonb_typeof(metadata -> 'discovery_interests') = 'array' THEN
    IF jsonb_array_length(metadata -> 'discovery_interests') BETWEEN 3 AND 8
      AND (metadata -> 'discovery_interests') <@
        '["Social easy runs","5K/10K training","Trail running","Speed workouts","Long runs","Race preparation","Coffee after a run","Exploring new routes"]'::jsonb
    THEN
      interests_value := ARRAY(
        SELECT DISTINCT jsonb_array_elements_text(metadata -> 'discovery_interests')
      );
    END IF;
  END IF;

  IF metadata ->> 'discovery_running_style' IN (
    'Easy and conversational', 'Focused training', 'A mix of both'
  ) THEN
    running_style_value := metadata ->> 'discovery_running_style';
  END IF;

  IF metadata ->> 'discovery_social_style' IN (
    'One-on-one', 'Small groups', 'Either works'
  ) THEN
    social_style_value := metadata ->> 'discovery_social_style';
  END IF;

  INSERT INTO public.runner_discovery (
    user_id,
    display_name,
    intention,
    city,
    neighborhood,
    interests,
    running_style,
    social_style,
    updated_at
  )
  VALUES (
    NEW.user_id,
    NEW.display_name,
    NEW.intention,
    NEW.city,
    NEW.neighborhood,
    interests_value,
    running_style_value,
    social_style_value,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      intention = EXCLUDED.intention,
      city = EXCLUDED.city,
      neighborhood = EXCLUDED.neighborhood,
      interests = CASE
        WHEN TG_OP = 'INSERT' THEN EXCLUDED.interests
        ELSE public.runner_discovery.interests
      END,
      running_style = CASE
        WHEN TG_OP = 'INSERT' THEN EXCLUDED.running_style
        ELSE public.runner_discovery.running_style
      END,
      social_style = CASE
        WHEN TG_OP = 'INSERT' THEN EXCLUDED.social_style
        ELSE public.runner_discovery.social_style
      END,
      updated_at = now();

  RETURN NEW;
END;
$$;

DROP FUNCTION public.save_my_discovery_answers(text[], text, text, text);

CREATE FUNCTION public.save_my_discovery_answers(
  p_interests text[],
  p_running_style text,
  p_social_style text
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

  IF p_interests IS NULL
    OR cardinality(p_interests) NOT BETWEEN 3 AND 8
    OR cardinality(p_interests) <> (
      SELECT count(DISTINCT interest)
      FROM unnest(p_interests) AS interest
    )
    OR NOT (
      p_interests <@ ARRAY[
        'Social easy runs',
        '5K/10K training',
        'Trail running',
        'Speed workouts',
        'Long runs',
        'Race preparation',
        'Coffee after a run',
        'Exploring new routes'
      ]::text[]
    )
    OR p_running_style IS NULL
    OR p_running_style NOT IN (
      'Easy and conversational', 'Focused training', 'A mix of both'
    )
    OR p_social_style IS NULL
    OR p_social_style NOT IN ('One-on-one', 'Small groups', 'Either works')
  THEN
    RAISE EXCEPTION 'The discovery answers are invalid.';
  END IF;

  UPDATE public.runner_discovery
  SET interests = p_interests,
      running_style = p_running_style,
      social_style = p_social_style,
      updated_at = now()
  WHERE user_id = user_id_value;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Discovery profile not found.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_my_discovery_answers(text[], text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_discovery_answers(text[], text, text)
  TO authenticated;
