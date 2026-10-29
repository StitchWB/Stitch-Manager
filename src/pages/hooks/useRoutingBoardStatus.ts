import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/backend/core/invoke';
import { getBackgroundManagerConfig } from '@/lib/backend/modules/backgroundManager';

export function useRoutingBoardStatus() {
  const [autoSwitchEnabled, setAutoSwitchEnabled] = useState<boolean | null>(null);
  const [holoneEnabled, setHoloneEnabled] = useState(false);
  const [holoneMode, setHoloneMode] = useState<'monitor' | 'block'>('monitor');
  const [holoneRuleCount, setHoloneRuleCount] = useState(0);
  const [holoneFindingsCount, setHoloneFindingsCount] = useState(0);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState<'lite' | 'full' | 'ultra'>('full');
  const [compressionEnabled, setCompressionEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getBackgroundManagerConfig();
        if (!cancelled) setAutoSwitchEnabled(cfg.autoSwitchEnabled);
      } catch (err) {
        console.warn('[AiProviders] Failed to fetch background-manager config:', err);
        if (!cancelled) setAutoSwitchEnabled(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/holone/status`);
        if (!res.ok) throw new Error('holone status fetch failed');
        const data = await res.json();
        if (!cancelled) {
          setHoloneEnabled(data.enabled);
          setHoloneMode(data.mode);
          setHoloneRuleCount(data.rule_count);
          setHoloneFindingsCount(data.findings_count);
        }
      } catch {
        // ponytail: holone may not be running; silently ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/compression/status`);
        if (!res.ok) throw new Error('compression status fetch failed');
        const data = await res.json();
        if (!cancelled) {
          setCavemanEnabled(data.caveman_enabled ?? false);
          setCavemanLevel(data.caveman_level ?? 'full');
          setCompressionEnabled(data.compression_enabled ?? false);
        }
      } catch {
        // ponytail: compression may not be running; silently ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    autoSwitchEnabled,
    holoneEnabled,
    holoneMode,
    holoneRuleCount,
    holoneFindingsCount,
    cavemanEnabled,
    cavemanLevel,
    compressionEnabled,
  };
}
