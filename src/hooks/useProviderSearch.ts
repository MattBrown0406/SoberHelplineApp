import { useState, useEffect } from 'react';
import {
  fetchProviders,
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
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResults([]);
    setAlsoRecommended([]);

    async function load() {
      const stateFilter = filters.state && filters.state !== 'Any state' ? filters.state : undefined;
      const opts = {
        state: stateFilter,
        insurance: filters.path === 'center' && filters.insurance.length ? filters.insurance : undefined,
        loc: filters.loc,
      };

      const main = await fetchProviders(filters.path, opts);
      if (cancelled) return;
      setResults(main);

      if (filters.path === 'center') {
        // Cross-sell only providers in the same state, so we don't surface an
        // interventionist three states away from the centers being viewed.
        const [ints, coaches] = await Promise.all([
          fetchProviders('interventionist', { state: stateFilter }).catch(() => []),
          fetchProviders('coach', { state: stateFilter }).catch(() => []),
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
  }, [filters.path, filters.state, filters.insurance, filters.loc, retryVersion]);

  function setPath(path: ProviderType) {
    setFilters((f) => ({ ...f, path, loc: null, insurance: path === 'center' ? f.insurance : [] }));
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
    retry: () => setRetryVersion((value) => value + 1),
  };
}
