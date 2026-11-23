CREATE OR REPLACE FUNCTION public.apply_face_preference_signal(
  p_user_id uuid,
  p_candidate_id uuid,
  p_signal smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate_vector extensions.vector(512);
  scaled_vector extensions.vector(512);
  current_vector extensions.vector(512);
  current_bias double precision := 0;
  current_samples integer := 0;
  probability double precision := 0.5;
  target_value double precision;
  learning_rate double precision := 0.08;
  gradient double precision;
  score_value double precision;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = p_user_id AND face_learning_consent
  ) THEN RETURN; END IF;
  SELECT embedding INTO candidate_vector
  FROM public.profile_face_vectors
  WHERE user_id = p_candidate_id;
  IF candidate_vector IS NULL THEN RETURN; END IF;

  SELECT preference_vector, bias, sample_count
  INTO current_vector, current_bias, current_samples
  FROM public.face_preference_models
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF current_vector IS NOT NULL THEN
    score_value := -(current_vector OPERATOR(extensions.<#>) candidate_vector) + current_bias;
    probability := 1.0 / (1.0 + exp(-GREATEST(-20.0, LEAST(20.0, score_value))));
  END IF;

  target_value := CASE WHEN p_signal = -1 THEN 0.0 ELSE 1.0 END;
  gradient := learning_rate * abs(p_signal)::double precision * (target_value - probability);
  scaled_vector := extensions.array_to_vector(
    ARRAY(
      SELECT component.value * gradient::real
      FROM unnest(extensions.vector_to_float4(candidate_vector, 512, false))
        WITH ORDINALITY AS component(value, position)
      ORDER BY component.position
    ),
    512,
    false
  );

  INSERT INTO public.face_preference_models (user_id, preference_vector, bias, sample_count, updated_at)
  VALUES (p_user_id, scaled_vector, gradient, 1, now())
  ON CONFLICT (user_id) DO UPDATE
  SET preference_vector = COALESCE(public.face_preference_models.preference_vector, scaled_vector)
        OPERATOR(extensions.+) scaled_vector,
      bias = public.face_preference_models.bias + gradient,
      sample_count = public.face_preference_models.sample_count + 1,
      updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.learn_from_profile_swipe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  signal_value smallint := CASE WHEN NEW.liked THEN 2 ELSE -1 END;
BEGIN
  INSERT INTO public.recommendation_interactions (user_id, candidate_id, signal, updated_at)
  VALUES (NEW.swiper_id, NEW.target_user_id, signal_value, now())
  ON CONFLICT (user_id, candidate_id) DO UPDATE
  SET signal = EXCLUDED.signal, updated_at = now();

  BEGIN
    PERFORM public.apply_face_preference_signal(NEW.swiper_id, NEW.target_user_id, signal_value);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Face preference update failed for swipe user % and candidate %: %',
      NEW.swiper_id, NEW.target_user_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.learn_from_profile_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  side record;
BEGIN
  FOR side IN
    SELECT NEW.user_one_id AS user_id, NEW.user_two_id AS candidate_id
    UNION ALL
    SELECT NEW.user_two_id, NEW.user_one_id
  LOOP
    INSERT INTO public.recommendation_interactions (user_id, candidate_id, signal, updated_at)
    VALUES (side.user_id, side.candidate_id, 3, now())
    ON CONFLICT (user_id, candidate_id) DO UPDATE
    SET signal = 3, updated_at = now();

    BEGIN
      PERFORM public.apply_face_preference_signal(side.user_id, side.candidate_id, 1);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Face preference update failed for match user % and candidate %: %',
        side.user_id, side.candidate_id, SQLERRM;
    END;
  END LOOP;
  RETURN NEW;
END;
$$;
