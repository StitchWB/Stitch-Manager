import { useCallback, useEffect, useState } from 'react';

import { getRegistrationJobs } from '../../lib/backend/modules/registration';
import type { RegistrationJob } from '../../types/ui';

const POLL_MS = 10_000;

export function useRegJobs(): { jobs: RegistrationJob[]; refreshRegJobs: () => Promise<void> } {
  const [jobs, setJobs] = useState<RegistrationJob[]>([]);

  const refreshRegJobs = useCallback(async () => {
    try {
      setJobs(await getRegistrationJobs());
    } catch (err) {
      console.warn('[useRegJobs] registration jobs:', err);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void refreshRegJobs();
    });
    const id = window.setInterval(() => {
      void refreshRegJobs();
    }, POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [refreshRegJobs]);

  return { jobs, refreshRegJobs };
}
