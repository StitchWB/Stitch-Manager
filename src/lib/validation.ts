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
