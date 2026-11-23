CREATE TABLE IF NOT EXISTS public.profile_swipe_deck_resets (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  reset_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profile_swipe_deck_resets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own swipe deck reset" ON public.profile_swipe_deck_resets;
CREATE POLICY "Users can read their own swipe deck reset"
  ON public.profile_swipe_deck_resets FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.profile_swipe_deck_resets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profile_swipe_deck_resets TO authenticated;

CREATE OR REPLACE FUNCTION public.reset_my_swipe_deck()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_id_value uuid := (SELECT auth.uid());
  previous_reset timestamptz;
  reset_swipe_count integer;
BEGIN
  IF user_id_value IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  SELECT reset_at
  INTO previous_reset
  FROM public.profile_swipe_deck_resets
  WHERE user_id = user_id_value;

  SELECT count(*)::integer
  INTO reset_swipe_count
  FROM public.profile_swipes
  WHERE swiper_id = user_id_value
    AND (previous_reset IS NULL OR updated_at > previous_reset);

  INSERT INTO public.profile_swipe_deck_resets (user_id, reset_at)
  VALUES (user_id_value, clock_timestamp())
  ON CONFLICT (user_id) DO UPDATE
  SET reset_at = EXCLUDED.reset_at;

  RETURN reset_swipe_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_my_swipe_deck() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_my_swipe_deck() TO authenticated;

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
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT discovery.user_id
    FROM public.runner_discovery AS discovery
    JOIN public.profiles AS candidate_profile ON candidate_profile.user_id = discovery.user_id
    WHERE discovery.user_id <> current_user_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.profile_swipes AS swipe
        WHERE swipe.swiper_id = current_user_id
          AND swipe.target_user_id = discovery.user_id
          AND swipe.updated_at > COALESCE(
            (
              SELECT deck_reset.reset_at
              FROM public.profile_swipe_deck_resets AS deck_reset
              WHERE deck_reset.user_id = current_user_id
            ),
            '-infinity'::timestamptz
          )
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

REVOKE ALL ON FUNCTION public.get_my_recommendation_scores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_recommendation_scores() TO authenticated;
