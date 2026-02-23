/**
 * Proxy utilities for parsing and validating proxy strings
 */

export interface ParsedProxy {
  host: string;
  port: string;
  username?: string;
  password?: string;
  type: 'http' | 'socks5';
}

/**
 * Parse proxy string in multiple formats:
 * - ip:port:username:password (NEW - auto-detect, no type prefix needed)
 * - ip:port (without auth)
 * - http://user:pass@host:port (legacy format)
 * 
 * @param proxyString - Proxy string to parse
 * @param defaultType - Default proxy type (http or socks5)
 * @returns Parsed proxy object or null if invalid
 */
export function parseProxyString(
  proxyString: string,
  defaultType: 'http' | 'socks5' = 'http'
): ParsedProxy | null {
  if (!proxyString || !proxyString.trim()) {
    return null;
  }

  const trimmed = proxyString.trim();

  // Check if it's a legacy URL format (http://... or socks5://...)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('socks5://')) {
    try {
      const url = new URL(trimmed);
      return {
        host: url.hostname,
        port: url.port || '8080',
        username: url.username || undefined,
        password: url.password || undefined,
        type: trimmed.startsWith('socks5://') ? 'socks5' : 'http',
      };
    } catch {
      return null;
    }
  }

  // Parse simple format: ip:port:username:password or ip:port
  const parts = trimmed.split(':');

  // Format: ip:port:username:password
  if (parts.length === 4) {
    const [host, port, username, password] = parts;
    
    if (!host || !port || !username || !password) {
      return null;
    }

    return {
      host,
      port,
      username,
      password,
      type: defaultType,
    };
  }

  // Format: ip:port (no auth)
  if (parts.length === 2) {
    const [host, port] = parts;
    
    if (!host || !port) {
      return null;
    }

    return {
      host,
      port,
      type: defaultType,
    };
  }

  // Invalid format
  return null;
}

/**
 * Build proxy URL from parsed proxy object
 * 
 * @param proxy - Parsed proxy object
 * @returns Proxy URL string (e.g., "http://user:pass@host:port")
 */
export function buildProxyUrl(proxy: ParsedProxy): string {
  const { host, port, username, password, type } = proxy;

  if (username && password) {
    return `${type}://${username}:${password}@${host}:${port}`;
  }

  return `${type}://${host}:${port}`;
}

/**
 * Validate proxy string format
 * 
 * @param proxyString - Proxy string to validate
 * @returns Error message or null if valid
 */
export function validateProxyString(proxyString: string): string | null {
  if (!proxyString || !proxyString.trim()) {
    return null; // Empty is valid (proxy disabled)
  }

  const parsed = parseProxyString(proxyString);
  
  if (!parsed) {
    return 'Invalid proxy format. Supported formats:\n• ip:port:username:password\n• ip:port\n• http://user:pass@host:port';
  }

  // Validate IP address or hostname (basic check)
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  if (!ipRegex.test(parsed.host) && !hostnameRegex.test(parsed.host)) {
    return 'Invalid IP address or hostname';
  }

  // Validate port number
  const portNum = parseInt(parsed.port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    return 'Invalid port number (must be 1-65535)';
  }

  return null;
}

/**
 * Format proxy for display (hide password)
 * 
 * @param proxyString - Proxy string
 * @returns Formatted string with hidden password
 */
export function formatProxyForDisplay(proxyString: string): string {
  const parsed = parseProxyString(proxyString);
  
  if (!parsed) {
    return proxyString;
  }

  if (parsed.username && parsed.password) {
    return `${parsed.host}:${parsed.port}:${parsed.username}:${'*'.repeat(parsed.password.length)}`;
  }

  return `${parsed.host}:${parsed.port}`;
}
