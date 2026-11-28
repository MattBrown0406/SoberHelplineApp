export type MondayMeeting = {
  meeting_date: string;
  topic: string;
  takeaway: string;
  welcome_url: string;
};
export function publicWelcomeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      [
        "youtube.com",
        "www.youtube.com",
        "youtu.be",
        "vimeo.com",
        "www.vimeo.com",
        "soberhelpline.com",
        "www.soberhelpline.com",
      ].includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function parseMondayMeeting(
  value: unknown,
  date: string,
): MondayMeeting | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    v.meeting_date !== date ||
    typeof v.topic !== "string" ||
    typeof v.takeaway !== "string"
  )
    return null;
  return {
    meeting_date: date,
    topic: v.topic.slice(0, 120),
    takeaway: v.takeaway.slice(0, 240),
    welcome_url: publicWelcomeUrl(v.welcome_url) || "",
  };
}
