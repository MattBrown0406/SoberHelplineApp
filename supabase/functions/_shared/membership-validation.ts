export function parseWebMembership(value: unknown): boolean {
  if (
    !value || typeof value !== "object" || !("isMember" in value) ||
    typeof value.isMember !== "boolean"
  ) {
    throw new Error("invalid website membership response");
  }
  return value.isMember;
}
