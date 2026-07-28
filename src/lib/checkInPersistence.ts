export interface PersistenceError {
  code?: string;
  message?: string;
}

export interface PersistenceResult<Row> {
  data: Row | null;
  error: PersistenceError | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Check-in IDs are written to a PostgreSQL uuid column, including on native. */
export function createCheckInId(generateUuid: () => string): string {
  const id = generateUuid();
  if (!UUID_PATTERN.test(id)) throw new Error('checkin_id_not_uuid');
  return id;
}

/** Merge cloud and device check-in histories without losing older cloud dates. */
export function mergeCheckInDates(...dateSets: ReadonlyArray<ReadonlyArray<string>>): string[] {
  return Array.from(new Set(dateSets.flat())).sort((left, right) => right.localeCompare(left));
}

/**
 * Inserts one daily check-in and resolves a duplicate-day race to the row that
 * already won. A duplicate can occur when the initial "today" read failed or
 * two save attempts overlapped; it should not surface as a failed check-in.
 */
export async function persistDailyCheckIn<Row>(
  insert: () => Promise<PersistenceResult<Row>>,
  loadExisting: () => Promise<PersistenceResult<Row>>,
): Promise<Row> {
  const inserted = await insert();
  if (!inserted.error && inserted.data) return inserted.data;

  if (inserted.error?.code !== '23505') {
    throw inserted.error ?? new Error('checkin_insert_returned_no_row');
  }

  const existing = await loadExisting();
  if (existing.error) throw existing.error;
  if (!existing.data) throw inserted.error;
  return existing.data;
}
