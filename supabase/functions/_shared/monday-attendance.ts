import { pacificDate } from "./family-squares-time.ts";
export type ZoomParticipant = {
  user_email?: unknown;
  join_time?: unknown;
  leave_time?: unknown;
  id?: unknown;
  user_id?: unknown;
};
export function zoomUuidPath(uuid: string): string {
  const encoded = encodeURIComponent(uuid);
  return uuid.includes("/") ? encodeURIComponent(encoded) : encoded;
}
export function attendanceReport(
  rows: ZoomParticipant[],
  start: string,
  end: string,
  date: string,
  now = Date.now(),
) {
  const from = Date.parse(start),
    until = Date.parse(end);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(until) ||
    until <= from ||
    until > now ||
    until - from > 86400000 ||
    pacificDate(new Date(from)) !== date
  )
    throw new Error("invalid occurrence");
  const groups = new Map<string, [number, number][]>();
  const unknown = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const joined =
      typeof row.join_time === "string" ? Date.parse(row.join_time) : NaN;
    const left =
      typeof row.leave_time === "string" ? Date.parse(row.leave_time) : NaN;
    if (!Number.isFinite(joined) || !Number.isFinite(left) || left < joined)
      throw new Error("incomplete participant report");
    const email =
      typeof row.user_email === "string"
        ? row.user_email.trim().toLowerCase()
        : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      unknown.add(
        typeof row.id === "string" && row.id
          ? row.id
          : typeof row.user_id === "string" && row.user_id
            ? row.user_id
            : `row:${index}`,
      );
      continue;
    }
    const lo = Math.max(from, joined),
      hi = Math.min(until, left);
    if (hi <= lo) continue;
    const spans = groups.get(email) || [];
    spans.push([lo, hi]);
    groups.set(email, spans);
  }
  const accounts = Array.from(groups, ([email, spans]) => {
    spans.sort((a, b) => a[0] - b[0]);
    let total = 0,
      lo = spans[0][0],
      hi = spans[0][1];
    for (const [a, b] of spans.slice(1)) {
      if (a <= hi) hi = Math.max(hi, b);
      else {
        total += hi - lo;
        lo = a;
        hi = b;
      }
    }
    return { email, seconds: Math.floor((total + hi - lo) / 1000) };
  });
  return { accounts, unmatched: unknown.size };
}
