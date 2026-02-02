import { NetworkCard, type NetworkConfig } from '../ui/NetworkCard';

interface NetworkTabProps {
  config: NetworkConfig;
  onChange: (updates: Partial<NetworkConfig>) => void;
  disabled?: boolean;
}

export function NetworkTab({ config, onChange, disabled }: NetworkTabProps) {
  return <NetworkCard config={config} onChange={onChange} disabled={disabled} />;
}
