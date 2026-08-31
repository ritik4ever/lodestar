import { renderHook, act } from '@testing-library/react';
import { useDebounce, SEARCH_DEBOUNCE_MS } from '@/hooks/useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('hello'));
    expect(result.current).toBe('hello');
  });

  it('does not update the debounced value before the interval elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    // Advance less than the full debounce interval — value must not have changed yet.
    act(() => { jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1); });
    expect(result.current).toBe('a');
  });

  it('updates the debounced value after the full interval elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    act(() => { jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS); });
    expect(result.current).toBe('ab');
  });

  it('coalesces rapid keystrokes and only applies the final value', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value),
      { initialProps: { value: '' } },
    );

    // Simulate fast typing: each character arrives before the timer fires.
    for (const char of ['s', 'se', 'sea', 'sear', 'searc', 'search']) {
      rerender({ value: char });
      act(() => { jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1); });
    }

    // Value must still be the original because the timer was always reset.
    expect(result.current).toBe('');

    // Now let the timer fire once.
    act(() => { jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS); });
    expect(result.current).toBe('search');
  });

  it('respects a custom delay when provided', () => {
    const customDelay = 500;
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value, customDelay),
      { initialProps: { value: 'x' } },
    );

    rerender({ value: 'xy' });

    // The default SEARCH_DEBOUNCE_MS (250) elapses but the custom delay has not.
    act(() => { jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS); });
    expect(result.current).toBe('x');

    // Now the full custom delay elapses.
    act(() => { jest.advanceTimersByTime(customDelay - SEARCH_DEBOUNCE_MS); });
    expect(result.current).toBe('xy');
  });

  it('SEARCH_DEBOUNCE_MS is the number 250', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(250);
  });
});
