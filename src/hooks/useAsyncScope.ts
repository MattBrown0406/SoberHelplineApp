import { useCallback, useEffect, useRef } from 'react';

/** One account/access lifetime. Invalidates old callbacks during render, not
 * only after effects, and also fences completions after unmount. */
export function useAsyncScope(key: string | null) {
  const ref = useRef({ key, active: true });
  if (ref.current.key !== key) {
    ref.current.active = false;
    ref.current = { key, active: true };
  }
  const scope = ref.current;
  useEffect(() => {
    scope.active = true;
    return () => { scope.active = false; };
  }, [scope]);
  const isCurrent = useCallback(() => ref.current === scope && scope.active, [scope]);
  return { scope, isCurrent };
}
