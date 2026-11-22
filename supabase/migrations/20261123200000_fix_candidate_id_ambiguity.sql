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
