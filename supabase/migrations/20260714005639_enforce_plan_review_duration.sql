-- The website and app sell plan review as one 60-minute person-to-person
-- coaching session. Enforce that contract below the client/RPC layer.
ALTER TABLE public.video_sessions
  ADD CONSTRAINT video_plan_review_duration
  CHECK (booking_purpose <> 'plan_review' OR duration_minutes = 60);
