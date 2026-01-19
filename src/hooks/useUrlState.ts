import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Custom hook to synchronize state with URL search parameters
 * Enables state persistence across page navigation and browser refresh
 * 
 * @param key - URL parameter key (e.g., 'provider', 'q', 'status')
 * @param defaultValue - Default value when parameter is not present
 * @returns [value, setValue] tuple similar to useState
 * 
 * @example
 * const [provider, setProvider] = useUrlState('provider', 'all');
 * // URL: ?provider=kiro
 * // provider === 'kiro'
 */
export function useUrlState<T extends string>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Initialize state from URL or use default
  const [state, setState] = useState<T>(() => {
    const paramValue = searchParams.get(key);
    return (paramValue as T) || defaultValue;
  });

  // Update state when URL changes (e.g., browser back/forward)
  useEffect(() => {
    const paramValue = searchParams.get(key);
    if (paramValue !== null && paramValue !== state) {
      setState(paramValue as T);
    } else if (paramValue === null && state !== defaultValue) {
      setState(defaultValue);
    }
  }, [searchParams, key, state, defaultValue]);

  // Update URL when state changes
  const setValue = useCallback(
    (newValue: T) => {
      setState(newValue);
      
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        
        if (newValue === defaultValue || newValue === '' || newValue === null) {
          // Remove parameter if it's the default value or empty
          newParams.delete(key);
        } else {
          // Set parameter to new value
          newParams.set(key, newValue);
        }
        
        return newParams;
      }, { replace: true }); // Use replace to avoid cluttering browser history
    },
    [key, defaultValue, setSearchParams]
  );

  return [state, setValue];
}
