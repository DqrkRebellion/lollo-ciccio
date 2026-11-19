import { useCallback, useEffect, useState } from 'react';
import type { ThemePreference } from '../types';

const STORAGE_KEY = 'lc_theme';

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    } catch {
      // ignore storage failures
    }
    return 'system';
  });

  const [resolvedDark, setResolvedDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return document.documentElement.classList.contains('dark');
  });

  const apply = useCallback((pref: ThemePreference) => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = pref === 'dark' || (pref === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    setResolvedDark(isDark);
  }, []);

  const setPreference = useCallback(
    (pref: ThemePreference) => {
      setPreferenceState(pref);
      try {
        localStorage.setItem(STORAGE_KEY, pref);
      } catch {
        // ignore
      }
      apply(pref);
    },
    [apply]
  );

  useEffect(() => {
    apply(preference);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (preference === 'system') apply('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference, apply]);

  return { preference, setPreference, isDark: resolvedDark };
}
