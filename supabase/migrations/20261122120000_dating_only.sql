UPDATE public.profiles
SET intention = 'Dating'
WHERE intention <> 'Dating';

UPDATE public.runner_discovery
SET intention = 'Dating'
WHERE intention <> 'Dating';

ALTER TABLE public.profiles
  ALTER COLUMN intention SET DEFAULT 'Dating',
  DROP CONSTRAINT IF EXISTS profiles_intention,
  ADD CONSTRAINT profiles_intention
    CHECK (intention = 'Dating');

ALTER TABLE public.runner_discovery
  DROP CONSTRAINT IF EXISTS runner_discovery_intention,
  ADD CONSTRAINT runner_discovery_intention
    CHECK (intention = 'Dating');
