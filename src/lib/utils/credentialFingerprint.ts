// Backend contract: SHA256(f"{endpoint_id}\0{secret}").hexdigest() in credential_service.py
export async function computeCredentialFingerprint(endpointId: string, secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${endpointId}\0${secret}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
