-- The seeded demo accounts are controlled test profiles. Enable face preference
-- learning for them so their photos participate in the recommendation demo.
UPDATE public.profiles
SET face_learning_consent = true
WHERE is_demo = true;
