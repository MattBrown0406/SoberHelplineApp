import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMondayMeeting, publicWelcomeUrl } from "../src/lib/mondayMeeting";
test("welcome links reject credentials, scripts, unexpected hosts and misleading suffixes", () => {
  for (const url of [
    "javascript:alert(1)",
    "https://youtube.com.evil.test/watch",
    "https://user:password@youtube.com/watch",
    "https://youtube.com:8443/watch",
    "http://vimeo.com/1",
    "https://evil.test",
  ])
    assert.equal(publicWelcomeUrl(url), null);
  assert.equal(
    publicWelcomeUrl("https://youtu.be/123"),
    "https://youtu.be/123",
  );
});
test("public content is bound to an occurrence and never exposes admin metadata", () => {
  const raw = {
    meeting_date: "2026-11-30",
    topic: "Boundaries",
    takeaway: "A useful sentence",
    welcome_url: "",
    zoom_uuid: "private-uuid",
  };
  assert.equal(parseMondayMeeting(raw, "2026-12-07"), null);
  assert.deepEqual(parseMondayMeeting(raw, "2026-11-30"), {
    meeting_date: "2026-11-30",
    topic: "Boundaries",
    takeaway: "A useful sentence",
    welcome_url: "",
  });
  assert.equal(parseMondayMeeting({}, "2026-11-30"), null);
});
