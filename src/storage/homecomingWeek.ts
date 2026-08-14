import * as SecureStore from 'expo-secure-store';
import {
  HOMECOMING_ITEMS,
  parseHomecomingWeekPlan,
  type HomecomingDischarge,
  type HomecomingIdentity,
  type HomecomingItemId,
  type HomecomingItemState,
  type HomecomingWeekPlan,
} from '../lib/homecomingWeek';
import {
  parseProtectedHomecomingHousingRecord,
  parseProtectedHomecomingRecord,
} from '../lib/homecomingProtectedRecord';
import {
  homecomingDischargeStorageKey,
  homecomingIdentityStorageKey,
  homecomingItemStorageKey,
  homecomingMetaStorageKey,
  type HomecomingDischargeSection,
} from '../lib/homecomingStorageKeys';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const SECTIONS: HomecomingDischargeSection[] = ['core', 'housing', 'sober', 'outpatient', 'recovery'];

const SECTION_KEYS: Record<HomecomingDischargeSection, (keyof HomecomingDischarge)[]> = {
  core: ['facilityName', 'dischargeDate', 'level', 'levelOther', 'otherInstructions'],
  housing: ['housingType', 'housingDetails', 'otherHousingFamilyStatus', 'receivingAdult', 'adultReturnHomeConfirmed', 'adultReturnHomeQuote', 'adultReturnHomeQuoteAffirmed'],
  sober: ['soberLivingStatus', 'soberLivingName', 'soberLivingCity', 'soberLivingPhone', 'soberLivingStartDate', 'soberLivingRules'],
  outpatient: ['outpatientStatus', 'outpatientName', 'outpatientStartDate', 'outpatientSchedule', 'outpatientTransport'],
  recovery: [
    'fellowship', 'fellowshipOther', 'meetingsKnown', 'firstMeetings', 'meetingPlace', 'backupMeeting',
    'employmentStatus', 'employmentDetails', 'employmentHelper', 'aftercareStatus', 'aftercareName',
    'aftercareContact', 'medicationStatus', 'medicationListHolder',
  ],
};

async function requireProtectedStorage(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) throw new Error('protected_storage_unavailable');
}

function sectionValue(discharge: HomecomingDischarge, section: HomecomingDischargeSection): Record<string, unknown> {
  return Object.fromEntries(SECTION_KEYS[section].map((key) => [key, discharge[key]]));
}

export async function loadProtectedHomecomingWeek(accountId: string): Promise<HomecomingWeekPlan> {
  await requireProtectedStorage();
  const [identityRaw, metaRaw, ...rows] = await Promise.all([
    SecureStore.getItemAsync(homecomingIdentityStorageKey(accountId), OPTIONS),
    SecureStore.getItemAsync(homecomingMetaStorageKey(accountId), OPTIONS),
    ...SECTIONS.map((section) => SecureStore.getItemAsync(homecomingDischargeStorageKey(accountId, section), OPTIONS)),
    ...HOMECOMING_ITEMS.map(({ id }) => SecureStore.getItemAsync(homecomingItemStorageKey(accountId, id), OPTIONS)),
  ]);
  const sectionRows = rows.slice(0, SECTIONS.length);
  const itemRows = rows.slice(SECTIONS.length);
  const discharge = Object.assign({}, ...sectionRows.map((raw, index) => {
    const section = SECTIONS[index];
    return section === 'housing'
      ? parseProtectedHomecomingHousingRecord(raw)
      : parseProtectedHomecomingRecord(raw, `discharge:${section}`, SECTION_KEYS[section]);
  }));
  const items: Record<string, unknown> = {};
  HOMECOMING_ITEMS.forEach(({ id }, index) => {
    items[id] = parseProtectedHomecomingRecord(
      itemRows[index], `item:${id}`, ['status', 'person', 'place', 'time', 'backup', 'details', 'updatedAt'],
    );
  });
  const updatedAt = parseProtectedHomecomingRecord(metaRaw, 'meta', 'updatedAt').updatedAt ?? null;
  const identity = parseProtectedHomecomingRecord(identityRaw, 'identity', ['preferredName', 'ageBand', 'exactAge', 'gender']);
  return parseHomecomingWeekPlan(JSON.stringify({ identity, discharge, items, updatedAt }));
}

async function saveMeta(accountId: string, updatedAt: string | null): Promise<void> {
  await SecureStore.setItemAsync(homecomingMetaStorageKey(accountId), JSON.stringify({ updatedAt }), OPTIONS);
}
export async function saveProtectedHomecomingIdentity(accountId: string, identity: HomecomingIdentity, updatedAt: string | null): Promise<void> {
  await requireProtectedStorage();
  await SecureStore.setItemAsync(homecomingIdentityStorageKey(accountId), JSON.stringify(identity), OPTIONS);
  await saveMeta(accountId, updatedAt);
}
export async function saveProtectedHomecomingDischarge(accountId: string, discharge: HomecomingDischarge, updatedAt: string | null): Promise<void> {
  await requireProtectedStorage();
  await Promise.all(SECTIONS.map((section) => SecureStore.setItemAsync(
    homecomingDischargeStorageKey(accountId, section), JSON.stringify(sectionValue(discharge, section)), OPTIONS,
  )));
  await saveMeta(accountId, updatedAt);
}
export async function saveProtectedHomecomingItem(
  accountId: string, id: HomecomingItemId, item: HomecomingItemState, updatedAt: string | null,
): Promise<void> {
  await requireProtectedStorage();
  await SecureStore.setItemAsync(homecomingItemStorageKey(accountId, id), JSON.stringify(item), OPTIONS);
  await saveMeta(accountId, updatedAt);
}
export async function clearProtectedHomecomingWeek(accountId: string): Promise<void> {
  await requireProtectedStorage();
  await Promise.all([
    SecureStore.deleteItemAsync(homecomingIdentityStorageKey(accountId), OPTIONS),
    SecureStore.deleteItemAsync(homecomingMetaStorageKey(accountId), OPTIONS),
    ...SECTIONS.map((section) => SecureStore.deleteItemAsync(homecomingDischargeStorageKey(accountId, section), OPTIONS)),
    ...HOMECOMING_ITEMS.map(({ id }) => SecureStore.deleteItemAsync(homecomingItemStorageKey(accountId, id), OPTIONS)),
  ]);
}
