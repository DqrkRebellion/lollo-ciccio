-- WebAuthn Passkeys & Biometric Unlock (Face ID / Touch ID / Android Biometrics)

CREATE TABLE IF NOT EXISTS public.user_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  promoter_id text NOT NULL,
  email text NOT NULL,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  algorithm integer NOT NULL DEFAULT -7,
  counter bigint NOT NULL DEFAULT 0,
  transports jsonb NOT NULL DEFAULT '["internal"]'::jsonb,
  device_name text NOT NULL DEFAULT 'Dispositivo',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_id ON public.user_passkeys (user_id);
CREATE INDEX IF NOT EXISTS idx_user_passkeys_promoter_id ON public.user_passkeys (promoter_id);

CREATE TABLE IF NOT EXISTS public.webauthn_challenges (
  challenge text PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('register', 'login')),
  user_id uuid,
  promoter_id text,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON public.webauthn_challenges (expires_at);

-- Strict RLS: users can only inspect/remove their own passkeys; challenges are service_role-only
ALTER TABLE public.user_passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_passkeys" ON public.user_passkeys
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "users_delete_own_passkeys" ON public.user_passkeys
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
