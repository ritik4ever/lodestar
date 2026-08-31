import { useState, useEffect } from 'react';

/** How long (in ms) to wait after the last keystroke before applying the search query. */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * Returns a debounced copy of `value` that only updates after the caller has
 * stopped changing it for `delay` milliseconds.
 *
 * @param value - The value to debounce (typically a controlled-input string).
 * @param delay - Debounce interval in milliseconds (defaults to SEARCH_DEBOUNCE_MS).
 */
export function useDebounce<T>(value: T, delay: number = SEARCH_DEBOUNCE_MS): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Cancel the pending update if value or delay changes before the timer fires.
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
