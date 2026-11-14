// Files in Storage do not cascade when an account is deleted: the member's
// Urgent Text Line photos (chat-attachments/<account_id>/…) would stay
// forever. Used by purge-account-files (the member deleting in the app) and
// website-account-deleted (the member deleting on soberhelpline.com).

const BUCKET = 'chat-attachments';
const PAGE = 100;
const MAX_DEPTH = 4;

interface StorageItem {
  name: string;
  id: string | null;
}

interface StorageBucket {
  list(prefix: string, options: { limit: number; offset: number }): Promise<{ data: StorageItem[] | null; error: unknown }>;
  remove(paths: string[]): Promise<{ error: unknown }>;
}

export interface StorageAdmin {
  storage: { from(bucket: string): StorageBucket };
}

async function listFiles(bucket: StorageBucket, prefix: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  const files: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`;
      // Folders come back without an id.
      if (item.id === null) files.push(...await listFiles(bucket, path, depth + 1));
      else files.push(path);
    }
    if (!data || data.length < PAGE) return files;
  }
}

/** Removes every stored file under the account's own folder. Returns how many. Throws on failure. */
export async function purgeAccountFiles(admin: StorageAdmin, accountId: string): Promise<number> {
  const bucket = admin.storage.from(BUCKET);
  const files = await listFiles(bucket, accountId);
  for (let i = 0; i < files.length; i += PAGE) {
    const { error } = await bucket.remove(files.slice(i, i + PAGE));
    if (error) throw error;
  }
  return files.length;
}
