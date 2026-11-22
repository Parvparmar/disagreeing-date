ALTER TABLE public.profile_matches
  ADD COLUMN IF NOT EXISTS match_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS profile_matches_match_id_key
  ON public.profile_matches (match_id);

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL UNIQUE
    REFERENCES public.profile_matches (match_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL
    REFERENCES public.conversations (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL
    REFERENCES public.profiles (user_id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT messages_content_length
    CHECK (char_length(btrim(content)) BETWEEN 1 AND 4000)
);

CREATE INDEX IF NOT EXISTS messages_conversation_created_at_idx
  ON public.messages (conversation_id, created_at);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Match participants can read conversations"
  ON public.conversations;
CREATE POLICY "Match participants can read conversations"
  ON public.conversations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profile_matches AS profile_match
      WHERE profile_match.match_id = conversations.match_id
        AND (SELECT auth.uid()) IN (profile_match.user_one_id, profile_match.user_two_id)
    )
  );

DROP POLICY IF EXISTS "Conversation participants can read messages"
  ON public.messages;
CREATE POLICY "Conversation participants can read messages"
  ON public.messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversations AS conversation
      JOIN public.profile_matches AS profile_match
        ON profile_match.match_id = conversation.match_id
      WHERE conversation.id = messages.conversation_id
        AND (SELECT auth.uid()) IN (profile_match.user_one_id, profile_match.user_two_id)
    )
  );

REVOKE ALL ON public.conversations, public.messages FROM anon, authenticated;
GRANT SELECT ON public.conversations, public.messages TO authenticated;

CREATE OR REPLACE FUNCTION public.create_conversation_for_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.conversations (match_id)
  VALUES (NEW.match_id)
  ON CONFLICT (match_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_conversation_for_match()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS create_conversation_after_match
  ON public.profile_matches;
CREATE TRIGGER create_conversation_after_match
  AFTER INSERT ON public.profile_matches
  FOR EACH ROW EXECUTE FUNCTION public.create_conversation_for_match();

INSERT INTO public.conversations (match_id)
SELECT profile_match.match_id
FROM public.profile_matches AS profile_match
ON CONFLICT (match_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_my_conversations()
RETURNS TABLE (
  conversation_id uuid,
  match_id uuid,
  other_user_id uuid,
  other_display_name text,
  other_photo_url text,
  last_message_content text,
  last_message_at timestamptz,
  unread_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_id_value uuid := (SELECT auth.uid());
BEGIN
  IF user_id_value IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  RETURN QUERY
  SELECT
    conversation.id,
    profile_match.match_id,
    other_profile.user_id,
    other_profile.display_name,
    other_profile.photo_url,
    latest_message.content,
    latest_message.created_at,
    (
      SELECT count(*)
      FROM public.messages AS unread
      WHERE unread.conversation_id = conversation.id
        AND unread.sender_id <> user_id_value
        AND unread.read_at IS NULL
    )
  FROM public.conversations AS conversation
  JOIN public.profile_matches AS profile_match
    ON profile_match.match_id = conversation.match_id
  JOIN public.profiles AS other_profile
    ON other_profile.user_id = CASE
      WHEN profile_match.user_one_id = user_id_value THEN profile_match.user_two_id
      ELSE profile_match.user_one_id
    END
  LEFT JOIN LATERAL (
    SELECT message.content, message.created_at
    FROM public.messages AS message
    WHERE message.conversation_id = conversation.id
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 1
  ) AS latest_message ON true
  WHERE user_id_value IN (profile_match.user_one_id, profile_match.user_two_id)
  ORDER BY latest_message.created_at DESC NULLS LAST, conversation.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_conversations()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_conversations()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.send_my_message(
  p_conversation_id uuid,
  p_content text
)
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  content text,
  created_at timestamptz,
  read_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_id_value uuid := (SELECT auth.uid());
  message_id uuid;
BEGIN
  IF user_id_value IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  IF p_conversation_id IS NULL
    OR p_content IS NULL
    OR char_length(btrim(p_content)) NOT BETWEEN 1 AND 4000
  THEN
    RAISE EXCEPTION 'Enter a message between 1 and 4000 characters.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations AS conversation
    JOIN public.profile_matches AS profile_match
      ON profile_match.match_id = conversation.match_id
    WHERE conversation.id = p_conversation_id
      AND user_id_value IN (profile_match.user_one_id, profile_match.user_two_id)
  ) THEN
    RAISE EXCEPTION 'You are not a participant in this conversation.';
  END IF;

  INSERT INTO public.messages AS inserted_message (
    conversation_id, sender_id, content
  )
  VALUES (p_conversation_id, user_id_value, btrim(p_content))
  RETURNING inserted_message.id INTO message_id;

  RETURN QUERY
  SELECT message.id, message.conversation_id, message.sender_id,
    message.content, message.created_at, message.read_at
  FROM public.messages AS message
  WHERE message.id = message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_my_message(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_my_message(uuid, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_my_conversation_read(
  p_conversation_id uuid
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations AS conversation
    JOIN public.profile_matches AS profile_match
      ON profile_match.match_id = conversation.match_id
    WHERE conversation.id = p_conversation_id
      AND user_id_value IN (profile_match.user_one_id, profile_match.user_two_id)
  ) THEN
    RAISE EXCEPTION 'You are not a participant in this conversation.';
  END IF;

  UPDATE public.messages
  SET read_at = now()
  WHERE conversation_id = p_conversation_id
    AND sender_id <> user_id_value
    AND read_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_my_conversation_read(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_my_conversation_read(uuid)
  TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END;
$$;
