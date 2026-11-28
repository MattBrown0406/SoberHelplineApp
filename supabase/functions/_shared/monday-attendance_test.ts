import { attendanceReport, zoomUuidPath } from "./monday-attendance.ts";
function eq(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
const start = "2026-11-17T03:00:00Z",
  end = "2026-11-17T04:00:00Z",
  now = Date.parse("2026-11-18T00:00:00Z");
Deno.test("reconnects and overlapping devices count elapsed time once", () => {
  const report = attendanceReport(
    [
      {
        user_email: " A@example.test ",
        join_time: "2026-11-17T02:50:00Z",
        leave_time: "2026-11-17T03:15:00Z",
      },
      {
        user_email: "a@example.test",
        join_time: "2026-11-17T03:10:00Z",
        leave_time: "2026-11-17T03:25:00Z",
      },
      {
        user_email: "a@example.test",
        join_time: "2026-11-17T03:30:00Z",
        leave_time: "2026-11-17T04:10:00Z",
      },
    ],
    start,
    end,
    "2026-11-16",
    now,
  );
  eq(report, {
    accounts: [{ email: "a@example.test", seconds: 3300 }],
    unmatched: 0,
  });
});
Deno.test(
  "unidentified guests never match by name and repeat guest IDs are deduplicated",
  () => {
    eq(
      attendanceReport(
        [
          { id: "guest", join_time: start, leave_time: end },
          { id: "guest", join_time: start, leave_time: end },
        ],
        start,
        end,
        "2026-11-16",
        now,
      ),
      { accounts: [], unmatched: 1 },
    );
  },
);
Deno.test("incomplete, future or wrong-occurrence reports fail closed", () => {
  for (const fn of [
    () =>
      attendanceReport(
        [{ user_email: "a@example.test", join_time: start }],
        start,
        end,
        "2026-11-16",
        now,
      ),
    () => attendanceReport([], start, end, "2026-11-23", now),
    () => attendanceReport([], start, end, "2026-11-16", 0),
  ]) {
    let threw = false;
    try {
      fn();
    } catch {
      threw = true;
    }
    eq(threw, true);
  }
});
Deno.test(
  "Zoom UUID path handles slashes and never interpolates a query",
  () => {
    eq(zoomUuidPath("/a//b="), "%252Fa%252F%252Fb%253D");
    eq(zoomUuidPath("abc?token=x"), "abc%3Ftoken%3Dx");
  },
);
