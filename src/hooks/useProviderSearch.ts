import { useMemo, useState } from 'react';
import {
  PROVIDERS,
  sortByAvailability,
  type Provider,
  type ProviderType,
} from '../api/providers';

export interface FinderFilters {
  path: ProviderType;
  state: string;
  zip: string;
  loc: string | null; // selected level-of-care / urgency key
  insurance: string[];
  age: string;
  gender: string;
  conditions: string[];
  modalities: string[];
  populations: string[];
}

const INITIAL: FinderFilters = {
  path: 'center',
  state: 'Florida',
  zip: '33301',
  loc: null,
  insurance: ['BCBS'],
  age: 'Adult',
  gender: 'Co-ed',
  conditions: ['Anxiety', 'Trauma / PTSD'],
  modalities: ['DBT', 'EMDR'],
  populations: [],
};

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * Holds the Treatment Finder filter state and derives the result list.
 * v1 filters by provider type and sorts available-first; richer filtering
 * (insurance/condition/modality intersection) drops in here when PROVIDERS
 * becomes a real query — the screens don't change.
 */
export function useProviderSearch() {
  const [filters, setFilters] = useState<FinderFilters>(INITIAL);

  function setPath(path: ProviderType) {
    setFilters((f) => ({ ...f, path }));
  }
  function setField<K extends keyof FinderFilters>(key: K, value: FinderFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }
  function toggleField(key: 'insurance' | 'conditions' | 'modalities' | 'populations', value: string) {
    setFilters((f) => ({ ...f, [key]: toggle(f[key], value) }));
  }

  const results = useMemo<Provider[]>(() => {
    const base = PROVIDERS.filter((p) => p.type === filters.path);
    return sortByAvailability(base);
  }, [filters.path]);

  // For the treatment-center path, surface a complementary interventionist + coach.
  const alsoRecommended = useMemo<Provider[]>(() => {
    if (filters.path !== 'center') return [];
    return PROVIDERS.filter((p) => p.id === 'mbrown' || p.id === 'coleman');
  }, [filters.path]);

  return {
    filters,
    setPath,
    setField,
    toggleField,
    results,
    alsoRecommended,
    resultCount: results.length,
  };
}
