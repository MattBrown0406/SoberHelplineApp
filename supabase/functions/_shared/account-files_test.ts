import { purgeAccountFiles, type StorageAdmin } from './account-files.ts';

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, received ${a}`);
}

async function assertRejects(fn: () => Promise<unknown>): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('expected the call to fail');
}


type Tree = { [name: string]: Tree | null };

/** In-memory bucket: folders are objects, files are null. */
function fakeAdmin(tree: Tree, options: { failRemove?: boolean } = {}) {
  const removed: string[] = [];
  const buckets: string[] = [];
  const admin: StorageAdmin = {
    storage: {
      from(bucket: string) {
        buckets.push(bucket);
        return {
          list(prefix: string, { limit, offset }: { limit: number; offset: number }) {
            let node: Tree | null = tree;
            for (const part of prefix.split('/')) node = node && part in node ? node[part] : null;
            const items = Object.entries(node ?? {}).map(([name, child]) => ({ name, id: child === null ? `id-${name}` : null }));
            return Promise.resolve({ data: items.slice(offset, offset + limit), error: null });
          },
          remove(paths: string[]) {
            if (options.failRemove) return Promise.resolve({ error: new Error('storage down') });
            removed.push(...paths);
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };
  return { admin, removed, buckets };
}

Deno.test('removes every file under the account folder, including nested ones', async () => {
  const { admin, removed, buckets } = fakeAdmin({
    'acct-1': { 'a.jpg': null, thread: { 'b.jpg': null, deeper: { 'c.png': null } } },
    'acct-2': { 'other.jpg': null },
  });
  assertEquals(await purgeAccountFiles(admin, 'acct-1'), 3);
  assertEquals(removed.sort(), ['acct-1/a.jpg', 'acct-1/thread/b.jpg', 'acct-1/thread/deeper/c.png']);
  assertEquals(buckets, ['chat-attachments']);
});

Deno.test('never touches another account folder', async () => {
  const { admin, removed } = fakeAdmin({ 'acct-1': {}, 'acct-2': { 'other.jpg': null } });
  assertEquals(await purgeAccountFiles(admin, 'acct-1'), 0);
  assertEquals(removed, []);
});

Deno.test('pages through more than one hundred files', async () => {
  const many: Tree = {};
  for (let i = 0; i < 250; i++) many[`f${i}.jpg`] = null;
  const { admin, removed } = fakeAdmin({ 'acct-1': many });
  assertEquals(await purgeAccountFiles(admin, 'acct-1'), 250);
  assertEquals(removed.length, 250);
});

Deno.test('a storage failure is reported, not swallowed', async () => {
  const { admin } = fakeAdmin({ 'acct-1': { 'a.jpg': null } }, { failRemove: true });
  await assertRejects(() => purgeAccountFiles(admin, 'acct-1'));
});
