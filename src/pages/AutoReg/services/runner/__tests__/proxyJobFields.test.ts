import { describe, it, expect } from '@jest/globals';
import { buildProxyJobFields } from '../proxyJobFields';
import { DEFAULT_CONFIG, type RegistrationConfig } from '../../../../../stores/registration/types';

function cloneConfig(): RegistrationConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as RegistrationConfig;
}

describe('buildProxyJobFields', () => {
  it('maps rotationEnabled to autoProxy and clears proxyUrl when rotating', () => {
    const config = cloneConfig();
    config.proxy.enabled = true;
    config.proxy.url = 'http://1.2.3.4:8080';
    config.proxy.rotationEnabled = true;

    const fields = buildProxyJobFields(config);
    expect(fields.autoProxy).toBe(true);
    expect(fields.proxyUrl).toBeNull();
  });

  it('sends the manual proxyUrl when rotation is off', () => {
    const config = cloneConfig();
    config.proxy.enabled = true;
    config.proxy.url = 'http://1.2.3.4:8080';
    config.proxy.rotationEnabled = false;

    const fields = buildProxyJobFields(config);
    expect(fields.autoProxy).toBe(false);
    expect(fields.proxyUrl).toBe('http://1.2.3.4:8080');
  });

  it('maps ipPolicy and ipReuseCount to the job fields', () => {
    const config = cloneConfig();
    config.proxy.ipPolicy = 'every_n';
    config.proxy.ipReuseCount = 5;

    const fields = buildProxyJobFields(config);
    expect(fields.proxyIpPolicy).toBe('every_n');
    expect(fields.proxyIpReuseCount).toBe(5);
  });

  it('falls back to per_run and 1 when unset', () => {
    const config = cloneConfig();
    delete config.proxy.ipPolicy;
    delete config.proxy.ipReuseCount;

    const fields = buildProxyJobFields(config);
    expect(fields.proxyIpPolicy).toBe('per_run');
    expect(fields.proxyIpReuseCount).toBe(1);
  });
});
