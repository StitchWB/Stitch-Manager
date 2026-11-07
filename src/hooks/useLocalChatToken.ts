import { useEffect, useState } from 'react';
import { getLocalChatToken } from '@/lib/backend/modules/aiProxy';

export function useLocalChatToken(): string {
  const [token, setToken] = useState('');
  useEffect(() => {
    let disposed = false;
    getLocalChatToken()
      .then(value => {
        if (!disposed) setToken(value);
      })
      .catch(() => {
        if (!disposed) setToken('');
      });
    return () => {
      disposed = true;
    };
  }, []);
  return token;
}
