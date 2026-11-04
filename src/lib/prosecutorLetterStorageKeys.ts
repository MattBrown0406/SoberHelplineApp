const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECURE_STORE_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

export function prosecutorLetterStorageKey(accountId: string): string {
  if (!UUID_PATTERN.test(accountId)) throw new Error('invalid_prosecutor_account_id');
  const key = `soberhelpline.prosecutor_letter.${accountId}`;
  if (!SECURE_STORE_KEY_PATTERN.test(key)) throw new Error('invalid_prosecutor_storage_key');
  return key;
}
