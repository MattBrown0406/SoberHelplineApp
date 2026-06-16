-- Admin RPCs gated to the owner email. SECURITY DEFINER so they can read
-- auth.users and update sessions without exposing those tables via RLS.

-- Update the weekly Zoom URL for The Family Squares.
CREATE OR REPLACE FUNCTION admin_update_family_squares_zoom_url(p_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'matt@soberhelpline.com' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE sessions SET zoom_url = p_url WHERE title = 'Monday Night Family Support';
END;
$$;

-- Return everyone who RSVPed to The Family Squares (status = going).
CREATE OR REPLACE FUNCTION admin_get_family_squares_rsvps()
RETURNS TABLE(first_name text, last_name text, email text, rsvped_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'matt@soberhelpline.com' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT a.first_name, a.last_name, u.email::text, sr.created_at
  FROM session_rsvps sr
  JOIN accounts a ON a.id  = sr.account_id
  JOIN auth.users u ON u.id = a.user_id
  JOIN sessions   s ON s.id = sr.session_id
  WHERE s.title = 'Monday Night Family Support'
    AND sr.status = 'going'
  ORDER BY sr.created_at DESC;
END;
$$;
