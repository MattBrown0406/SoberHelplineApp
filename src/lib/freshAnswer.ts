/**
 * Her latest answer wins over a slow read.
 *
 * Today and Support show "going" / "can't make it" the moment she taps, then
 * the server catches up. A read of the same data that began BEFORE that tap
 * (or while it was being saved) still carries the old answer; if it lands
 * afterwards it must not put the old answer back on screen.
 *
 * The hooks keep a counter that goes up with every answer. A read notes the
 * counter when it starts; if the counter has moved by the time it lands, the
 * answer on screen is newer than the read. Pure, so tests pin it.
 */
export interface AnswerFields {
  id: string;
  rsvped: boolean;
  declined?: boolean;
  zoom_url: string | null;
}

/**
 * `loaded` is what a read brought back, `onScreen` what is showing now.
 * When she has answered since the read began, her answer is kept (and a
 * personal link she was just given is kept if the read has none); everything
 * else comes from the read.
 */
export function withFreshAnswer<T extends AnswerFields>(
  loaded: T,
  onScreen: AnswerFields | null | undefined,
  answeredSinceReadBegan: boolean,
): T {
  if (!answeredSinceReadBegan || !onScreen || onScreen.id !== loaded.id) return loaded;
  return { ...loaded, rsvped: onScreen.rsvped, declined: onScreen.declined, zoom_url: loaded.zoom_url ?? onScreen.zoom_url };
}
