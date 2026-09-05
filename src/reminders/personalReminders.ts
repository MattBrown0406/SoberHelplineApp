/** Device-local reminders. No account/category/text is sent to the notification payload. */
export const REMINDER_PREFIX = 'personal-reminder-v1-';
export const REMINDER_CATEGORIES = ['boundary', 'meeting', 'learning', 'coaching'] as const;
export type ReminderCategory = typeof REMINDER_CATEGORIES[number];
export type ReminderLocale = 'en' | 'es';
export type PersonalReminder = { category: ReminderCategory; hour: number; minute: number; enabled: boolean; notificationId: string | null; locale: ReminderLocale };
export type ReminderSnapshot = { accountId: string | null; ready: boolean; supported: boolean; items: readonly PersonalReminder[]; error: string | null };
export interface ReminderBoundary {
  supported: boolean;
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  list(): Promise<string[]>;
  cancel(id: string): Promise<void>;
  permission(request: boolean): Promise<boolean>;
  schedule(id: string, hour: number, minute: number, locale: ReminderLocale): Promise<void>;
  id(): string;
}
function validTime(hour: number, minute: number) {
  return Number.isInteger(hour) && hour >= 0 && hour < 24 && Number.isInteger(minute) && minute >= 0 && minute < 60;
}
function parse(raw: string | null, accountId: string): PersonalReminder[] {
  if (raw === null) return [];
  try {
    const doc = JSON.parse(raw);
    if (doc.version !== 1 || doc.accountId !== accountId || !Array.isArray(doc.items) || doc.items.length > 4) throw Error();
    const seen = new Set(); const ids = new Set();
    for (const r of doc.items) {
      if (!r || !REMINDER_CATEGORIES.includes(r.category) || seen.has(r.category) || !validTime(r.hour, r.minute)
        || typeof r.enabled !== 'boolean' || !['en', 'es'].includes(r.locale)
        || (r.enabled ? typeof r.notificationId !== 'string' || !r.notificationId.startsWith(REMINDER_PREFIX) || ids.has(r.notificationId) : r.notificationId !== null)) throw Error();
      seen.add(r.category); if (r.notificationId) ids.add(r.notificationId);
    }
    return doc.items.map((r: PersonalReminder) => ({ category: r.category, hour: r.hour, minute: r.minute, enabled: r.enabled, notificationId: r.notificationId, locale: r.locale }));
  } catch { throw Error('storage'); }
}

/** One shared instance, serial IO, synchronous identity invalidation, explicit edits only. */
export class PersonalReminderService {
  private state: ReminderSnapshot;
  private generation = 0;
  private initialized = false;
  private cancellationRequired = false;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  constructor(private boundary: ReminderBoundary) {
    this.state = { accountId: null, ready: false, supported: boundary.supported, items: [], error: null };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<ReminderSnapshot>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn); this.queue = next.catch(() => undefined); return next;
  }
  private current(generation: number) { if (generation !== this.generation) throw Error('account'); }
  private key(account: string) { return `personal-reminders:v1:${encodeURIComponent(account)}`; }
  private async persist(account: string, items: readonly PersonalReminder[]) {
    await this.boundary.write(this.key(account), JSON.stringify({ version: 1, accountId: account, items }));
  }
  private async cancelOwned(keep = new Set<string>()) {
    const ids = await this.boundary.list();
    const failures = await Promise.allSettled(ids.filter(id => id.startsWith(REMINDER_PREFIX) && !keep.has(id)).map(id => this.boundary.cancel(id)));
    if (failures.some(r => r.status === 'rejected')) throw Error('cancel');
    // Native success must agree with the actual pending schedule.
    if ((await this.boundary.list()).some(id => id.startsWith(REMINDER_PREFIX) && !keep.has(id))) throw Error('cancel');
  }
  setAccount(accountId: string | null): Promise<void> {
    const changed = this.initialized && this.state.accountId !== accountId;
    const refresh = this.initialized && this.state.accountId === accountId;
    this.initialized = true;
    // Keep cancellation intent even when rapid A -> B -> A transitions supersede B.
    if (changed) this.cancellationRequired = true;
    // A permission dialog can foreground the app: same-account reconciliation must
    // queue behind the explicit edit, not invalidate it or erase its working items.
    const generation = refresh ? this.generation : ++this.generation;
    if (!refresh) this.publish({ accountId, items: [], ready: false, supported: this.boundary.supported, error: null });
    return this.serial(async () => {
      try {
        this.current(generation);
        if (!this.boundary.supported) { this.publish({ ready: true }); return; }
        // A real in-process account change cancels everything owned, not other features.
        if (this.cancellationRequired) {
          await this.cancelOwned();
          this.current(generation);
          this.cancellationRequired = false;
        }
        this.current(generation);
        if (!accountId) { await this.cancelOwned(); this.current(generation); this.publish({ ready: true }); return; }
        let items: PersonalReminder[];
        try { items = parse(await this.boundary.read(this.key(accountId)), accountId); }
        catch (error) { await this.cancelOwned(); throw error; }
        this.current(generation);
        const pending = new Set(await this.boundary.list());
        this.current(generation);
        // No silent re-enabling after logout, OS removal, revocation, or corruption.
        const hasEnabled = items.some(item => item.enabled);
        const permitted = hasEnabled ? await this.boundary.permission(false) : false;
        this.current(generation);
        items = items.map(r => r.enabled && (!permitted || !pending.has(r.notificationId!)) ? { ...r, enabled: false, notificationId: null } : r);
        await this.cancelOwned(new Set(items.flatMap(r => r.notificationId ? [r.notificationId] : [])));
        this.current(generation);
        this.publish({ items, ready: true, error: null });
      } catch (error) {
        if (generation === this.generation) this.publish({ ready: false, items: [], error: error instanceof Error ? error.message : 'failed' });
        throw error;
      }
    });
  }
  private edit(fn: (account: string, generation: number) => Promise<void>): Promise<void> {
    const generation = this.generation; const account = this.state.accountId;
    return this.serial(async () => {
      this.current(generation);
      if (!this.boundary.supported) throw Error('unavailable');
      if (!account || !this.state.ready) throw Error('not-ready');
      try { await fn(account, generation); }
      catch (error) {
        if (generation === this.generation) this.publish({ error: error instanceof Error ? error.message : 'failed' });
        throw error;
      }
    });
  }
  enable(category: ReminderCategory, hour: number, minute: number, locale: ReminderLocale): Promise<void> {
    return this.edit(async (account, generation) => {
      if (!REMINDER_CATEGORIES.includes(category) || !validTime(hour, minute) || !['en', 'es'].includes(locale)) throw Error('invalid');
      if (this.state.items.some(r => r.category === category && r.enabled)) throw Error('already-enabled');
      // Only invoked by an explicit enable/resume button, never lifecycle/hydration.
      if (!await this.boundary.permission(true)) throw Error('permission');
      this.current(generation);
      const id = this.boundary.id();
      if (!id.startsWith(REMINDER_PREFIX)) throw Error('identifier');
      try {
        await this.boundary.schedule(id, hour, minute, locale);
        this.current(generation);
        if (!(await this.boundary.list()).includes(id)) throw Error('schedule');
        this.current(generation);
        const items = [...this.state.items.filter(r => r.category !== category), { category, hour, minute, locale, enabled: true, notificationId: id }];
        await this.persist(account, items);
        this.current(generation);
        this.publish({ items, error: null });
      } catch (error) {
        try {
          await this.boundary.cancel(id);
          if ((await this.boundary.list()).includes(id)) throw Error('cancel');
        } catch {
          if (generation === this.generation) this.publish({ ready: false, error: 'cancel' });
          throw Error('cancel');
        }
        // A storage write may have partially succeeded: require reconciliation before edits.
        if (generation === this.generation) this.publish({ ready: false });
        throw error;
      }
    });
  }
  private disable(category: ReminderCategory, remove: boolean) {
    return this.edit(async (account, generation) => {
      const item = this.state.items.find(r => r.category === category);
      if (!item) return;
      try {
        if (item.notificationId) {
          await this.boundary.cancel(item.notificationId);
          if ((await this.boundary.list()).includes(item.notificationId)) throw Error('cancel');
        }
        this.current(generation);
        const items = remove ? this.state.items.filter(r => r.category !== category) : this.state.items.map(r => r.category === category ? { ...r, enabled: false, notificationId: null } : r);
        await this.persist(account, items);
        this.current(generation); this.publish({ items, error: null });
      } catch (error) {
        if (generation === this.generation) this.publish({ ready: false });
        throw error;
      }
    });
  }
  pause(category: ReminderCategory) { return this.disable(category, false); }
  remove(category: ReminderCategory) { return this.disable(category, true); }
}
