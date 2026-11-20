import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'https://dqrkrebellion.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
]);

function corsHeaders(origin: string | null) {
  const allowed =
    origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://dqrkrebellion.github.io';
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

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Configurazione Supabase mancante' }, 500, origin);
    }

    // 1. Strictly verify caller is an authenticated app user
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return jsonResponse({ error: 'Autenticazione richiesta' }, 401, origin);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonResponse({ error: 'Sessione non valida o scaduta' }, 401, origin);
    }

    // 2. Read server-side GitHub secrets (never exposed to client)
    const githubToken = (Deno.env.get('GITHUB_TOKEN') || '').trim();
    const githubOwner = (Deno.env.get('GITHUB_OWNER') || '').trim();
    const githubRepo = (Deno.env.get('GITHUB_REPO') || '').trim();

    if (!githubToken || !githubOwner || !githubRepo) {
      const missing = [
        !githubToken && 'GITHUB_TOKEN',
        !githubOwner && 'GITHUB_OWNER',
        !githubRepo && 'GITHUB_REPO',
      ].filter(Boolean);
      return jsonResponse(
        {
          error: `Secrets mancanti su Supabase Edge Functions: ${missing.join(', ')}`,
          missing_secrets: missing,
        },
        500,
        origin
      );
    }

    let includeTerminated = 'true';
    try {
      const body = await req.json();
      if (body && body.include_terminated === false) {
        includeTerminated = 'false';
      }
    } catch {
      // Empty body is valid; default include_terminated = "true"
    }

    // 3. Trigger GitHub Actions workflow dispatch
    const dispatchUrl = `https://api.github.com/repos/${encodeURIComponent(
      githubOwner
    )}/${encodeURIComponent(githubRepo)}/actions/workflows/sync-ticketsms.yml/dispatches`;

    const ghRes = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'lollo-ciccio-pr-ticketsms-trigger',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          include_terminated: includeTerminated,
        },
      }),
    });

    if (ghRes.status === 204 || ghRes.ok) {
      return jsonResponse(
        {
          ok: true,
          dispatched_at: new Date().toISOString(),
          triggered_by: userData.user.email,
        },
        200,
        origin
      );
    }

    let ghDetail = `HTTP ${ghRes.status}`;
    try {
      const errJson = await ghRes.json();
      if (errJson?.message) ghDetail = String(errJson.message);
    } catch {
      // ignore parse failure
    }

    return jsonResponse(
      {
        error: `Errore GitHub Actions (${ghRes.status}): ${ghDetail}`,
      },
      ghRes.status === 401 || ghRes.status === 403 ? 502 : 500,
      origin
    );
  } catch (err) {
    console.error('trigger-ticketsms-sync failed:', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Errore interno sincronizzazione' },
      500,
      origin
    );
  }
});
