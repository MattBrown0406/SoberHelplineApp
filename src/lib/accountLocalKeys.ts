/** Device-storage keys that belong to any of these account / auth-user ids. */
export function accountLocalKeys(keys: readonly string[], ids: readonly string[]): string[] {
  const needles = ids.filter((id) => id.length >= 16);
  return keys.filter((key) => needles.some((id) => key.includes(id)));
}
