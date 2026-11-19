import { supabase } from './supabase';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://inltzlcgccfnblfepnkw.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlubHR6bGNnY2NmbmJsZmVwbmt3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwOTU0NTUsImV4cCI6MjExMDY3MTQ1NX0.e9HPwrgvjBg7kNMSmLWESQJ0aX2-m0dSOD2gITW3C1M';

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/passkey-auth`;

const ENROLLED_KEY_PREFIX = 'lc_bio_cred_';
const LOCK_ON_OPEN_KEY = 'lc_lock_on_open';
const PROMPT_DISMISSED_PREFIX = 'lc_bio_dismissed_';
const UNLOCKED_SESSION_KEY = 'lc_session_unlocked';

export type BiometricPlatform = 'ios' | 'macos' | 'android' | 'windows' | 'other';

export interface BiometricCapability {
  supported: boolean;
  platform: BiometricPlatform;
  label: string; // e.g. "Face ID", "Touch ID", "Impronta / Volto", "Windows Hello"
  deviceName: string;
}

export interface StoredPasskey {
  id: string;
  credential_id: string;
  device_name: string;
  created_at: string;
  last_used_at: string | null;
}

function toBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): ArrayBuffer {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function detectPlatform(): { platform: BiometricPlatform; label: string; deviceName: string } {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIPhone = /iPhone/i.test(ua);
  const isIPad =
    /iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIPhone) return { platform: 'ios', label: 'Face ID', deviceName: 'iPhone' };
  if (isIPad) return { platform: 'ios', label: 'Face ID / Touch ID', deviceName: 'iPad' };
  if (/Android/i.test(ua)) {
    return { platform: 'android', label: 'Impronta / Volto', deviceName: 'Android' };
  }
  if (/Mac/i.test(ua)) return { platform: 'macos', label: 'Touch ID', deviceName: 'Mac' };
  if (/Win/i.test(ua)) return { platform: 'windows', label: 'Windows Hello', deviceName: 'Windows PC' };
  return { platform: 'other', label: 'Biometria', deviceName: 'Dispositivo' };
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  const meta = detectPlatform();
  if (
    typeof window === 'undefined' ||
    !window.isSecureContext ||
    typeof window.PublicKeyCredential === 'undefined' ||
    typeof navigator.credentials === 'undefined'
  ) {
    return { supported: false, ...meta };
  }
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return { supported: Boolean(available), ...meta };
  } catch {
    return { supported: false, ...meta };
  }
}

export function getLocalCredentialId(promoterId: string): string | null {
  try {
    return localStorage.getItem(`${ENROLLED_KEY_PREFIX}${promoterId}`);
  } catch {
    return null;
  }
}

export function setLocalCredentialId(promoterId: string, credentialId: string | null) {
  try {
    if (credentialId) {
      localStorage.setItem(`${ENROLLED_KEY_PREFIX}${promoterId}`, credentialId);
    } else {
      localStorage.removeItem(`${ENROLLED_KEY_PREFIX}${promoterId}`);
    }
  } catch {
    // ignore
  }
}

export function isLockOnOpenEnabled(): boolean {
  try {
    return localStorage.getItem(LOCK_ON_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLockOnOpenEnabled(enabled: boolean) {
  try {
    localStorage.setItem(LOCK_ON_OPEN_KEY, enabled ? '1' : '0');
  } catch {
    // ignore
  }
}

export function isSessionUnlockedThisVisit(): boolean {
  try {
    return sessionStorage.getItem(UNLOCKED_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSessionUnlockedThisVisit(unlocked: boolean) {
  try {
    if (unlocked) {
      sessionStorage.setItem(UNLOCKED_SESSION_KEY, '1');
    } else {
      sessionStorage.removeItem(UNLOCKED_SESSION_KEY);
    }
  } catch {
    // ignore
  }
}

export function isBiometricPromptDismissed(promoterId: string): boolean {
  try {
    return localStorage.getItem(`${PROMPT_DISMISSED_PREFIX}${promoterId}`) === '1';
  } catch {
    return false;
  }
}

export function setBiometricPromptDismissed(promoterId: string, dismissed: boolean) {
  try {
    if (dismissed) {
      localStorage.setItem(`${PROMPT_DISMISSED_PREFIX}${promoterId}`, '1');
    } else {
      localStorage.removeItem(`${PROMPT_DISMISSED_PREFIX}${promoterId}`);
    }
  } catch {
    // ignore
  }
}

async function callPasskeyApi<T>(payload: Record<string, unknown>, authToken?: string): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Errore server (${res.status})`);
  }
  return data as T;
}

/**
 * Registers Face ID / Touch ID / Android Biometrics for the currently logged-in user.
 */
export async function enrollDeviceBiometrics(
  promoterId: string
): Promise<{ credentialId: string; deviceName: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Sessione non attiva');

  const meta = detectPlatform();

  // 1. Get WebAuthn creation options from Supabase Edge Function
  const opts = await callPasskeyApi<{
    challenge: string;
    rp: { name: string; id: string };
    user: { id: string; name: string; displayName: string };
    pubKeyCredParams: PublicKeyCredentialParameters[];
    timeout: number;
    attestation: AttestationConveyancePreference;
    authenticatorSelection: AuthenticatorSelectionCriteria;
    excludeCredentials?: { type: 'public-key'; id: string; transports?: AuthenticatorTransport[] }[];
  }>({ action: 'register-options' }, accessToken);

  const publicKeyOptions: PublicKeyCredentialCreationOptions = {
    challenge: fromBase64Url(opts.challenge),
    rp: opts.rp,
    user: {
      id: fromBase64Url(opts.user.id),
      name: opts.user.name,
      displayName: opts.user.displayName,
    },
    pubKeyCredParams: opts.pubKeyCredParams,
    timeout: opts.timeout,
    attestation: opts.attestation,
    authenticatorSelection: opts.authenticatorSelection,
    excludeCredentials: (opts.excludeCredentials || []).map((c) => ({
      type: 'public-key',
      id: fromBase64Url(c.id),
      transports: c.transports,
    })),
  };

  // 2. Prompt native Face ID / Touch ID / Android Biometrics
  const credential = (await navigator.credentials.create({
    publicKey: publicKeyOptions,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Registrazione biometrica annullata');
  }

  const response = credential.response as AuthenticatorAttestationResponse;
  const spki = response.getPublicKey?.();
  const authData = response.getAuthenticatorData?.();
  const algorithm = response.getPublicKeyAlgorithm?.() ?? -7;
  const transports = response.getTransports?.() ?? ['internal'];

  if (!spki || !authData) {
    throw new Error('Il browser non espone la chiave pubblica WebAuthn');
  }

  const credentialId = toBase64Url(credential.rawId);

  // 3. Verify & persist on Supabase
  await callPasskeyApi(
    {
      action: 'register-verify',
      credentialId,
      publicKey: toBase64Url(spki),
      algorithm,
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(authData),
      transports,
      deviceName: meta.deviceName,
    },
    accessToken
  );

  setLocalCredentialId(promoterId, credentialId);
  setLockOnOpenEnabled(true);
  setBiometricPromptDismissed(promoterId, false);

  return { credentialId, deviceName: meta.deviceName };
}

export type BiometricLoginResult =
  | { status: 'ok'; promoterId: string }
  | { status: 'needs_gesture' }
  | { status: 'cancelled' }
  | { status: 'not_enrolled' }
  | { status: 'error'; message: string };

/**
 * Verifies Face ID / Touch ID / Android Biometrics and establishes a real Supabase session.
 */
export async function unlockWithBiometrics(
  promoterId: string,
  options: { silentAuto?: boolean } = {}
): Promise<BiometricLoginResult> {
  try {
    const serverOpts = await callPasskeyApi<{
      challenge: string;
      rpId: string;
      timeout: number;
      userVerification: UserVerificationRequirement;
      allowCredentials: { type: 'public-key'; id: string; transports?: AuthenticatorTransport[] }[];
    }>({ action: 'login-options', promoterId });

    if (!serverOpts.allowCredentials || serverOpts.allowCredentials.length === 0) {
      setLocalCredentialId(promoterId, null);
      return { status: 'not_enrolled' };
    }

    // Prioritize this device's own credential so iOS/Android goes straight to Face ID / Fingerprint
    const localCredId = getLocalCredentialId(promoterId);
    const orderedCreds = [...serverOpts.allowCredentials];
    if (localCredId) {
      orderedCreds.sort((a, b) => (a.id === localCredId ? -1 : b.id === localCredId ? 1 : 0));
    }

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: fromBase64Url(serverOpts.challenge),
        rpId: serverOpts.rpId,
        timeout: serverOpts.timeout,
        userVerification: 'required',
        allowCredentials: orderedCreds.map((c) => ({
          type: 'public-key',
          id: fromBase64Url(c.id),
          transports: c.transports,
        })),
      },
    })) as PublicKeyCredential | null;

    if (!assertion) {
      return { status: 'cancelled' };
    }

    const response = assertion.response as AuthenticatorAssertionResponse;
    const credentialId = toBase64Url(assertion.rawId);

    // Cryptographically verify assertion on Edge Function and mint real Supabase OTP token
    const verified = await callPasskeyApi<{
      ok: boolean;
      email: string;
      promoterId: string;
      tokenHash: string;
    }>({
      action: 'login-verify',
      credentialId,
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
    });

    const { error: otpErr } = await supabase.auth.verifyOtp({
      token_hash: verified.tokenHash,
      type: 'magiclink',
    });
    if (otpErr) throw otpErr;

    setLocalCredentialId(verified.promoterId, credentialId);
    markSessionUnlockedThisVisit(true);
    return { status: 'ok', promoterId: verified.promoterId };
  } catch (err) {
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
        return { status: options.silentAuto ? 'needs_gesture' : 'cancelled' };
      }
      if (err.name === 'InvalidStateError') {
        return { status: 'not_enrolled' };
      }
    }
    const msg = err instanceof Error ? err.message : 'Verifica biometrica non riuscita';
    return { status: 'error', message: msg };
  }
}

export async function listOwnPasskeys(): Promise<StoredPasskey[]> {
  const { data, error } = await supabase
    .from('user_passkeys')
    .select('id, credential_id, device_name, created_at, last_used_at')
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data || []) as StoredPasskey[];
}

export async function deletePasskey(id: string, credentialId: string, promoterId: string) {
  const { error } = await supabase.from('user_passkeys').delete().eq('id', id);
  if (error) throw error;
  if (getLocalCredentialId(promoterId) === credentialId) {
    setLocalCredentialId(promoterId, null);
  }
}
