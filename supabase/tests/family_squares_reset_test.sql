BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(6);

-- Tuesday 2026-11-03 02:00 Pacific, after Monday 2026-11-02's call.
SELECT ok(public._family_squares_rsvp_expired(NULL, '2026-11-02T18:30:00-08:00', '2026-11-03 02:00'),
  'an undated RSVP from before Monday''s call is reset');
SELECT ok(NOT public._family_squares_rsvp_expired(NULL, '2026-11-02T20:30:00-08:00', '2026-11-03 02:00'),
  'an undated (4.1) RSVP made after the call ended is kept for next Monday');
SELECT ok(public._family_squares_rsvp_expired(NULL, '2026-11-02T19:59:00-08:00', '2026-11-03 02:00'),
  'an undated RSVP made during the call is reset');
SELECT ok(public._family_squares_rsvp_expired('2026-11-02', '2026-10-28T10:00:00-07:00', '2026-11-03 02:00'),
  'a dated RSVP for the past Monday is reset');
SELECT ok(NOT public._family_squares_rsvp_expired('2026-11-09', '2026-11-02T20:30:00-08:00', '2026-11-03 02:00'),
  'a dated RSVP for next Monday is kept');
SELECT ok(NOT public._family_squares_rsvp_expired(NULL, '2026-10-26T20:15:00-07:00', '2026-10-27 02:00'),
  'the 8 PM boundary follows Pacific daylight time too');

SELECT * FROM finish();
ROLLBACK;
