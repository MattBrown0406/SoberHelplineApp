import { useState, useEffect } from 'react';
import {
  fetchProviders,
  sortByAvailability,
  type Provider,
  type ProviderType,
} from '../api/providers';

export interface FinderFilters {
  path: ProviderType;
  state: string;
  zip: string;
  loc: string | null;
  insurance: string[];
  age: string;
  gender: string;
  conditions: string[];
  modalities: string[];
  populations: string[];
}

const INITIAL: FinderFilters = {
  path: 'center',
  state: '',
  zip: '',
  loc: null,
  insurance: [],
  age: 'Adult',
  gender: 'Co-ed',
  conditions: [],
  modalities: [],
  populations: [],
};

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function useProviderSearch() {
  const [filters, setFilters] = useState<FinderFilters>(INITIAL);
  const [results, setResults] = useState<Provider[]>([]);
  const [alsoRecommended, setAlsoRecommended] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      const opts = {
        state: filters.state || undefined,
        insurance: filters.insurance.length ? filters.insurance : undefined,
      };

      const main = await fetchProviders(filters.path, opts);
      if (cancelled) return;
      setResults(sortByAvailability(main));

      if (filters.path === 'center') {
        const [ints, coaches] = await Promise.all([
          fetchProviders('interventionist'),
          fetchProviders('coach'),
        ]);
        if (cancelled) return;
        const also: Provider[] = [];
        if (ints[0]) also.push(ints[0]);
        if (coaches[0]) also.push(coaches[0]);
        setAlsoRecommended(also);
      } else {
        setAlsoRecommended([]);
      }
    }

    load()
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [filters.path, filters.state, filters.insurance]);

  function setPath(path: ProviderType) {
    setFilters((f) => ({ ...f, path }));
  }
  function setField<K extends keyof FinderFilters>(key: K, value: FinderFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }
  function toggleField(key: 'insurance' | 'conditions' | 'modalities' | 'populations', value: string) {
    setFilters((f) => ({ ...f, [key]: toggle(f[key], value) }));
  }

  return {
    filters,
    setPath,
    setField,
    toggleField,
    results,
    alsoRecommended,
    resultCount: results.length,
    loading,
    error,
  };
}
