CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS face_learning_consent boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.profile_photos (
  photo_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.face_features (
  photo_id uuid PRIMARY KEY REFERENCES public.profile_photos (photo_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  embedding extensions.vector(512) NOT NULL,
  quality_score real NOT NULL CHECK (quality_score >= 0 AND quality_score <= 1),
  detector_confidence real NOT NULL CHECK (detector_confidence >= 0 AND detector_confidence <= 1),
  model_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS face_features_user_quality_idx
  ON public.face_features (user_id, quality_score DESC);

CREATE TABLE IF NOT EXISTS public.profile_face_vectors (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  embedding extensions.vector(512) NOT NULL,
  photo_count integer NOT NULL CHECK (photo_count > 0),
  quality_score real NOT NULL CHECK (quality_score >= 0 AND quality_score <= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.face_preference_models (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  preference_vector extensions.vector(512),
  bias double precision NOT NULL DEFAULT 0,
  sample_count integer NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recommendation_interactions (
  user_id uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  signal smallint NOT NULL CHECK (signal IN (-1, 2, 3)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, candidate_id),
  CHECK (user_id <> candidate_id)
);

ALTER TABLE public.profile_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_face_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_preference_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendation_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their photo processing records"
  ON public.profile_photos FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can view their recommendation interactions"
  ON public.recommendation_interactions FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.profile_photos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.face_features FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.profile_face_vectors FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.face_preference_models FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.recommendation_interactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profile_photos TO authenticated;
GRANT SELECT ON public.recommendation_interactions TO authenticated;
GRANT ALL ON public.profile_photos TO service_role;
GRANT ALL ON public.face_features TO service_role;
GRANT ALL ON public.profile_face_vectors TO service_role;
GRANT ALL ON public.face_preference_models TO service_role;
GRANT ALL ON public.recommendation_interactions TO service_role;

CREATE OR REPLACE FUNCTION public.set_my_face_learning_consent(p_enabled boolean)
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
  UPDATE public.profiles
  SET face_learning_consent = p_enabled
  WHERE user_id = user_id_value;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile was not found.';
  END IF;
  IF NOT p_enabled THEN
    DELETE FROM public.profile_photos WHERE user_id = user_id_value;
    DELETE FROM public.profile_face_vectors WHERE user_id = user_id_value;
    DELETE FROM public.face_preference_models WHERE user_id = user_id_value;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_face_learning_consent(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_face_learning_consent(boolean) TO authenticated;

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

  INSERT INTO public.face_preference_models (user_id, preference_vector, bias, sample_count, updated_at)
  VALUES (
    p_user_id,
    candidate_vector * gradient,
    gradient,
    1,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET preference_vector = COALESCE(public.face_preference_models.preference_vector, candidate_vector * gradient)
        + candidate_vector * gradient,
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
  PERFORM public.apply_face_preference_signal(NEW.swiper_id, NEW.target_user_id, signal_value);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS learn_from_profile_swipe ON public.profile_swipes;
CREATE TRIGGER learn_from_profile_swipe
  AFTER INSERT OR UPDATE OF liked ON public.profile_swipes
  FOR EACH ROW EXECUTE FUNCTION public.learn_from_profile_swipe();

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
    PERFORM public.apply_face_preference_signal(side.user_id, side.candidate_id, 1);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS learn_from_profile_match ON public.profile_matches;
CREATE TRIGGER learn_from_profile_match
  AFTER INSERT ON public.profile_matches
  FOR EACH ROW EXECUTE FUNCTION public.learn_from_profile_match();

INSERT INTO public.recommendation_interactions (user_id, candidate_id, signal, updated_at)
SELECT swiper_id, target_user_id, CASE WHEN liked THEN 2 ELSE -1 END, updated_at
FROM public.profile_swipes
ON CONFLICT (user_id, candidate_id) DO UPDATE
SET signal = EXCLUDED.signal, updated_at = EXCLUDED.updated_at;

UPDATE public.recommendation_interactions AS interaction
SET signal = 3,
    updated_at = match.created_at
FROM public.profile_matches AS match
WHERE (interaction.user_id = match.user_one_id AND interaction.candidate_id = match.user_two_id)
   OR (interaction.user_id = match.user_two_id AND interaction.candidate_id = match.user_one_id);

CREATE OR REPLACE FUNCTION public.face_preference_probability(
  p_user_id uuid,
  p_candidate_id uuid
)
RETURNS double precision
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN preference.preference_vector IS NULL OR candidate.embedding IS NULL THEN 0.5
    ELSE 1.0 / (1.0 + exp(-GREATEST(-20.0, LEAST(20.0,
      -(preference.preference_vector OPERATOR(extensions.<#>) candidate.embedding) + preference.bias
    ))))
  END
  FROM (SELECT p_user_id AS user_id) AS requested
  LEFT JOIN public.face_preference_models AS preference ON preference.user_id = requested.user_id
  LEFT JOIN public.profile_face_vectors AS candidate ON candidate.user_id = p_candidate_id;
$$;

CREATE OR REPLACE FUNCTION public.get_my_recommendation_scores()
RETURNS TABLE (
  candidate_id uuid,
  personal_score double precision,
  reverse_score double precision,
  collaborative_score double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid := (SELECT auth.uid());
BEGIN
  IF current_user_id IS NULL THEN RAISE EXCEPTION 'Authentication is required.'; END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT discovery.user_id
    FROM public.runner_discovery AS discovery
    JOIN public.profiles AS candidate_profile ON candidate_profile.user_id = discovery.user_id
    WHERE discovery.user_id <> current_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.profile_swipes AS swipe
        WHERE swipe.swiper_id = current_user_id AND swipe.target_user_id = discovery.user_id
      )
  ), my_history AS (
    SELECT interaction.candidate_id, interaction.signal::double precision AS signal
    FROM public.recommendation_interactions AS interaction
    WHERE interaction.user_id = current_user_id
  ), peer_similarity AS (
    SELECT peer.user_id,
      SUM(mine.signal * peer.signal)::double precision
        / NULLIF(SQRT(SUM(mine.signal * mine.signal) * SUM(peer.signal * peer.signal)), 0) AS similarity
    FROM my_history AS mine
    JOIN public.recommendation_interactions AS peer ON peer.candidate_id = mine.candidate_id
    WHERE peer.user_id <> current_user_id
    GROUP BY peer.user_id
  ), collaborative AS (
    SELECT interactions.candidate_id,
      0.5 + 0.5 * SUM(similarity.similarity * interactions.signal / 3.0)
        / NULLIF(SUM(abs(similarity.similarity)), 0) AS score
    FROM peer_similarity AS similarity
    JOIN public.recommendation_interactions AS interactions ON interactions.user_id = similarity.user_id
    WHERE similarity.similarity > 0
    GROUP BY interactions.candidate_id
  )
  SELECT candidates.user_id,
    public.face_preference_probability(current_user_id, candidates.user_id),
    public.face_preference_probability(candidates.user_id, current_user_id),
    COALESCE(collaborative.score, 0.5)
  FROM candidates
  LEFT JOIN collaborative ON collaborative.candidate_id = candidates.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_face_preference_signal(uuid, uuid, smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.learn_from_profile_swipe() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.learn_from_profile_match() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.face_preference_probability(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_recommendation_scores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_recommendation_scores() TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_face_preference_signal(uuid, uuid, smallint) TO service_role;
