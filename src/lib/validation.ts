/**
 * Validation utilities for form inputs
 */

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate port number (1-65535)
 */
export function validatePort(port: string | number): string | null {
  const portNum = typeof port === 'string' ? parseInt(port, 10) : port;
  
  if (isNaN(portNum)) {
    return 'Port must be a number';
  }
  
  if (portNum < 1 || portNum > 65535) {
    return 'Port must be between 1 and 65535';
  }
  
  return null;
}

/**
 * Validate hostname or IP address
 */
export function validateHostname(hostname: string): string | null {
  if (!hostname || hostname.trim() === '') {
    return 'Hostname is required';
  }
  
  // Check for valid hostname pattern (alphanumeric, dots, hyphens)
  const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  // Check for valid IPv4 pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  
  if (hostnamePattern.test(hostname)) {
    return null;
  }
  
  if (ipv4Pattern.test(hostname)) {
    // Validate IP octets are 0-255
    const octets = hostname.split('.');
    const validOctets = octets.every(octet => {
      const num = parseInt(octet, 10);
      return num >= 0 && num <= 255;
    });
    
    if (validOctets) {
      return null;
    }
  }
  
  return 'Invalid hostname or IP address';
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): string | null {
  if (!url || url.trim() === '') {
    return null; // Empty is valid for optional fields
  }
  
  try {
    const urlObj = new URL(url);
    
    // Check for valid protocol
    if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(urlObj.protocol)) {
      return 'URL must use http, https, socks4, or socks5 protocol';
    }
    
    return null;
  } catch {
    return 'Invalid URL format';
  }
}

/**
 * Validate email format
 */
export function validateEmail(email: string): string | null {
  if (!email || email.trim() === '') {
    return 'Email is required';
  }
  
  // Basic email pattern
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!emailPattern.test(email)) {
    return 'Invalid email format';
  }
  
  return null;
}

/**
 * Validate all settings fields
 */
export function validateSettings(settings: {
  imapServer?: string;
  imapPort?: string | number;
  imapEmail?: string;
  proxyUrl?: string;
  proxyEnabled?: boolean;
}): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // Validate IMAP server if provided
  if (settings.imapServer && settings.imapServer.trim() !== '') {
    const hostnameError = validateHostname(settings.imapServer);
    if (hostnameError) {
      errors.push({ field: 'imapServer', message: hostnameError });
    }
  }
  
  // Validate IMAP port if provided
  if (settings.imapPort !== undefined && settings.imapPort !== '') {
    const portError = validatePort(settings.imapPort);
    if (portError) {
      errors.push({ field: 'imapPort', message: portError });
    }
  }
  
  // Validate IMAP email if provided
  if (settings.imapEmail && settings.imapEmail.trim() !== '') {
    const emailError = validateEmail(settings.imapEmail);
    if (emailError) {
      errors.push({ field: 'imapEmail', message: emailError });
    }
  }
  
  // Validate proxy URL if proxy is enabled
  if (settings.proxyEnabled && settings.proxyUrl) {
    const urlError = validateUrl(settings.proxyUrl);
    if (urlError) {
      errors.push({ field: 'proxyUrl', message: urlError });
    }
  }
  
  return errors;
}
