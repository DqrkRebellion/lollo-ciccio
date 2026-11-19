import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'https://dqrkrebellion.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
]);

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://dqrkrebellion.github.io';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Converts an ASN.1 DER-encoded ECDSA signature (used by WebAuthn authenticators)
 * into the 64-byte IEEE P1363 (r || s) format expected by WebCrypto ECDSA P-256.
 */
function derToP1363(der: Uint8Array): Uint8Array {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error('Invalid DER signature sequence');
  let seqLen = der[offset++];
  if (seqLen & 0x80) {
    const lenBytes = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < lenBytes; i++) seqLen = (seqLen << 8) | der[offset++];
  }

  const readInt = (): Uint8Array => {
    if (der[offset++] !== 0x02) throw new Error('Invalid DER integer');
    let len = der[offset++];
    if (len & 0x80) {
      const lenBytes = len & 0x7f;
      len = 0;
      for (let i = 0; i < lenBytes; i++) len = (len << 8) | der[offset++];
    }
    let slice = der.subarray(offset, offset + len);
    offset += len;
    // Strip leading zero padding bytes
    while (slice.length > 32 && slice[0] === 0x00) {
      slice = slice.subarray(1);
    }
    const fixed = new Uint8Array(32);
    fixed.set(slice, 32 - slice.length);
    return fixed;
  };

  const r = readInt();
  const s = readInt();
  return concatBytes(r, s);
}

function getRpIdFromOrigin(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return 'dqrkrebellion.github.io';
  }
}

async function verifySignature(
  publicKeyBase64Url: string,
  algorithm: number,
  authData: Uint8Array,
  clientDataBytes: Uint8Array,
  signatureBytes: Uint8Array
): Promise<boolean> {
  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataBytes));
  const signedData = concatBytes(authData, clientDataHash);
  const spkiBytes = fromBase64Url(publicKeyBase64Url);

  if (algorithm === -7) {
    // ES256 (ECDSA w/ P-256 and SHA-256)
    const key = await crypto.subtle.importKey(
      'spki',
      spkiBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const rawSig = derToP1363(signatureBytes);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, rawSig, signedData);
  }

  if (algorithm === -257) {
    // RS256 (RSASSA-PKCS1-v1_5 w/ SHA-256)
    const key = await crypto.subtle.importKey(
      'spki',
      spkiBytes,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signatureBytes, signedData);
  }

  throw new Error(`Unsupported WebAuthn algorithm: ${algorithm}`);
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  const requestOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://dqrkrebellion.github.io';
  const rpId = getRpIdFromOrigin(requestOrigin);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json();
    const action = String(body.action || '');

    // Clean up expired challenges opportunistically
    await admin.from('webauthn_challenges').delete().lt('expires_at', new Date().toISOString());

    // Helper: authenticate caller via JWT
    const getCallerUser = async () => {
      const authHeader = req.headers.get('authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!token) return null;
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data?.user) return null;
      return data.user;
    };

    // 1. REGISTER OPTIONS (authenticated user enrolling Face ID / Fingerprint)
    if (action === 'register-options') {
      const user = await getCallerUser();
      if (!user || !user.email) {
        return jsonResponse({ error: 'Autenticazione richiesta' }, 401, origin);
      }

      const challengeBytes = new Uint8Array(32);
      crypto.getRandomValues(challengeBytes);
      const challenge = toBase64Url(challengeBytes);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const promoterId = String(
        user.user_metadata?.promoter_id || (user.email.startsWith('ciccio') ? 'ciccio' : 'lollo')
      );

      const { error: chErr } = await admin.from('webauthn_challenges').insert({
        challenge,
        purpose: 'register',
        user_id: user.id,
        promoter_id: promoterId,
        expires_at: expiresAt,
      });
      if (chErr) throw chErr;

      const { data: existing } = await admin
        .from('user_passkeys')
        .select('credential_id, transports')
        .eq('user_id', user.id);

      const displayName = String(
        user.user_metadata?.display_name || (promoterId === 'ciccio' ? 'Ciccio' : 'Lollo')
      );

      return jsonResponse(
        {
          challenge,
          rp: { name: 'Lollo & Ciccio PR', id: rpId },
          user: {
            id: toBase64Url(new TextEncoder().encode(user.id)),
            name: user.email,
            displayName: `${displayName} · Lollo & Ciccio`,
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          timeout: 60000,
          attestation: 'none',
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
            requireResidentKey: false,
          },
          excludeCredentials: (existing || []).map((k) => ({
            type: 'public-key',
            id: k.credential_id,
            transports: Array.isArray(k.transports) ? k.transports : ['internal'],
          })),
        },
        200,
        origin
      );
    }

    // 2. REGISTER VERIFY (stores verified platform public key)
    if (action === 'register-verify') {
      const user = await getCallerUser();
      if (!user || !user.email) {
        return jsonResponse({ error: 'Autenticazione richiesta' }, 401, origin);
      }

      const {
        credentialId,
        publicKey,
        algorithm = -7,
        clientDataJSON,
        authenticatorData,
        transports = ['internal'],
        deviceName = 'Dispositivo',
      } = body;

      if (!credentialId || !publicKey || !clientDataJSON || !authenticatorData) {
        return jsonResponse({ error: 'Dati WebAuthn incompleti' }, 400, origin);
      }

      const clientDataBytes = fromBase64Url(clientDataJSON);
      const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));

      if (clientData.type !== 'webauthn.create') {
        return jsonResponse({ error: 'Tipo clientData non valido' }, 400, origin);
      }
      if (!ALLOWED_ORIGINS.has(clientData.origin)) {
        return jsonResponse({ error: `Origine non autorizzata: ${clientData.origin}` }, 400, origin);
      }

      const { data: chRow } = await admin
        .from('webauthn_challenges')
        .select('*')
        .eq('challenge', clientData.challenge)
        .eq('purpose', 'register')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!chRow || new Date(chRow.expires_at).getTime() < Date.now()) {
        return jsonResponse({ error: 'Challenge scaduta o non valida' }, 400, origin);
      }
      await admin.from('webauthn_challenges').delete().eq('challenge', clientData.challenge);

      const authData = fromBase64Url(authenticatorData);
      if (authData.length < 37) {
        return jsonResponse({ error: 'authenticatorData troppo corto' }, 400, origin);
      }
      const expectedRpHash = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(getRpIdFromOrigin(clientData.origin)))
      );
      if (!bytesEqual(authData.subarray(0, 32), expectedRpHash)) {
        return jsonResponse({ error: 'rpIdHash non corrisponde' }, 400, origin);
      }

      const flags = authData[32];
      const userPresent = (flags & 0x01) !== 0;
      const userVerified = (flags & 0x04) !== 0;
      if (!userPresent || !userVerified) {
        return jsonResponse({ error: 'Verifica biometrica richiesta' }, 400, origin);
      }

      const counter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false);
      const promoterId = String(
        user.user_metadata?.promoter_id || (user.email.startsWith('ciccio') ? 'ciccio' : 'lollo')
      );

      const { data: saved, error: insErr } = await admin
        .from('user_passkeys')
        .upsert(
          {
            user_id: user.id,
            promoter_id: promoterId,
            email: user.email,
            credential_id: credentialId,
            public_key: publicKey,
            algorithm: Number(algorithm) || -7,
            counter,
            transports,
            device_name: String(deviceName).slice(0, 80),
            last_used_at: new Date().toISOString(),
          },
          { onConflict: 'credential_id' }
        )
        .select('id, credential_id, device_name, created_at')
        .single();

      if (insErr) throw insErr;

      return jsonResponse({ ok: true, passkey: saved }, 200, origin);
    }

    // 3. LOGIN OPTIONS (public — issues single-use challenge + allowCredentials)
    if (action === 'login-options') {
      const promoterId = body.promoterId ? String(body.promoterId) : null;
      const challengeBytes = new Uint8Array(32);
      crypto.getRandomValues(challengeBytes);
      const challenge = toBase64Url(challengeBytes);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      const { error: chErr } = await admin.from('webauthn_challenges').insert({
        challenge,
        purpose: 'login',
        promoter_id: promoterId,
        expires_at: expiresAt,
      });
      if (chErr) throw chErr;

      let query = admin.from('user_passkeys').select('credential_id, transports');
      if (promoterId) query = query.eq('promoter_id', promoterId);
      const { data: keys } = await query;

      return jsonResponse(
        {
          challenge,
          rpId,
          timeout: 60000,
          userVerification: 'required',
          allowCredentials: (keys || []).map((k) => ({
            type: 'public-key',
            id: k.credential_id,
            transports: Array.isArray(k.transports) ? k.transports : ['internal'],
          })),
        },
        200,
        origin
      );
    }

    // 4. LOGIN VERIFY (public — cryptographically verifies Face ID / Fingerprint signature & mints real Supabase session)
    if (action === 'login-verify') {
      const { credentialId, clientDataJSON, authenticatorData, signature } = body;
      if (!credentialId || !clientDataJSON || !authenticatorData || !signature) {
        return jsonResponse({ error: 'Risposta biometrica incompleta' }, 400, origin);
      }

      const { data: passkey } = await admin
        .from('user_passkeys')
        .select('*')
        .eq('credential_id', credentialId)
        .maybeSingle();

      if (!passkey) {
        return jsonResponse({ error: 'Dispositivo non registrato. Accedi con il PIN.' }, 401, origin);
      }

      const clientDataBytes = fromBase64Url(clientDataJSON);
      const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));

      if (clientData.type !== 'webauthn.get') {
        return jsonResponse({ error: 'Tipo autenticazione non valido' }, 401, origin);
      }
      if (!ALLOWED_ORIGINS.has(clientData.origin)) {
        return jsonResponse({ error: 'Origine non autorizzata' }, 401, origin);
      }

      const { data: chRow } = await admin
        .from('webauthn_challenges')
        .select('*')
        .eq('challenge', clientData.challenge)
        .eq('purpose', 'login')
        .maybeSingle();

      if (!chRow || new Date(chRow.expires_at).getTime() < Date.now()) {
        return jsonResponse({ error: 'Sessione biometrica scaduta. Riprova.' }, 401, origin);
      }
      await admin.from('webauthn_challenges').delete().eq('challenge', clientData.challenge);

      const authData = fromBase64Url(authenticatorData);
      if (authData.length < 37) {
        return jsonResponse({ error: 'authenticatorData non valido' }, 401, origin);
      }

      const expectedRpHash = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(getRpIdFromOrigin(clientData.origin)))
      );
      if (!bytesEqual(authData.subarray(0, 32), expectedRpHash)) {
        return jsonResponse({ error: 'rpIdHash non valido' }, 401, origin);
      }

      const flags = authData[32];
      if ((flags & 0x01) === 0 || (flags & 0x04) === 0) {
        return jsonResponse({ error: 'Verifica biometrica non completata' }, 401, origin);
      }

      const newCounter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false);
      const storedCounter = Number(passkey.counter) || 0;
      if (storedCounter > 0 && newCounter > 0 && newCounter <= storedCounter) {
        return jsonResponse({ error: 'Contatore sicurezza non valido' }, 401, origin);
      }

      const valid = await verifySignature(
        passkey.public_key,
        Number(passkey.algorithm) || -7,
        authData,
        clientDataBytes,
        fromBase64Url(signature)
      );

      if (!valid) {
        return jsonResponse({ error: 'Firma biometrica non valida' }, 401, origin);
      }

      await admin
        .from('user_passkeys')
        .update({
          counter: Math.max(storedCounter, newCounter),
          last_used_at: new Date().toISOString(),
        })
        .eq('id', passkey.id);

      // Mint a real Supabase Auth OTP token_hash for instant zero-password login
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: passkey.email,
      });
      if (linkErr || !linkData?.properties?.hashed_token) {
        throw linkErr || new Error('Impossibile generare token sessione');
      }

      return jsonResponse(
        {
          ok: true,
          email: passkey.email,
          promoterId: passkey.promoter_id,
          tokenHash: linkData.properties.hashed_token,
        },
        200,
        origin
      );
    }

    return jsonResponse({ error: `Azione non supportata: ${action}` }, 400, origin);
  } catch (err) {
    console.error('passkey-auth error:', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Errore server biometria' },
      500,
      origin
    );
  }
});
