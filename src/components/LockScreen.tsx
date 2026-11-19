import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Delete, Fingerprint, Lock, ScanFace } from 'lucide-react';
import { supabase, TEAM_ACCOUNTS } from '../lib/supabase';
import {
  getBiometricCapability,
  getLocalCredentialId,
  markSessionUnlockedThisVisit,
  unlockWithBiometrics,
  type BiometricCapability,
} from '../lib/biometrics';
import { APPLE_SPRING, APPLE_SPRING_SNAPPY } from './ui/AppleControls';

const PIN_LENGTH = 6;

export function LockScreen({
  onAuthenticated,
}: {
  onAuthenticated: (method: 'pin' | 'biometric', promoterId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<'lollo' | 'ciccio'>(() => {
    try {
      const saved = localStorage.getItem('lc_last_user');
      if (saved === 'ciccio') return 'ciccio';
    } catch {
      // ignore
    }
    return 'lollo';
  });
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioHint, setBioHint] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [capability, setCapability] = useState<BiometricCapability | null>(null);

  const autoTriedForRef = useRef<string | null>(null);
  const account = TEAM_ACCOUNTS.find((a) => a.promoterId === selectedId) || TEAM_ACCOUNTS[0];
  const hasLocalPasskey = Boolean(getLocalCredentialId(selectedId));
  const showBioButton = Boolean(capability?.supported);
  const isFaceId = capability?.platform === 'ios';
  const BioIcon = isFaceId ? ScanFace : Fingerprint;

  useEffect(() => {
    let active = true;
    getBiometricCapability().then((cap) => {
      if (active) setCapability(cap);
    });
    return () => {
      active = false;
    };
  }, []);

  const triggerBiometricUnlock = useCallback(
    async (promoterId: 'lollo' | 'ciccio', silentAuto: boolean) => {
      if (bioBusy || loading) return;
      setBioBusy(true);
      setErrorMsg(null);
      setBioHint(silentAuto ? null : `Verifica ${capability?.label || 'biometrica'} in corso…`);

      const res = await unlockWithBiometrics(promoterId, { silentAuto });
      setBioBusy(false);

      if (res.status === 'ok') {
        try {
          localStorage.setItem('lc_last_user', res.promoterId);
        } catch {
          // ignore
        }
        setBioHint(null);
        onAuthenticated('biometric', res.promoterId);
        return;
      }

      if (res.status === 'needs_gesture') {
        // Safari on iOS sometimes requires a direct tap on cold load — invite cleanly without error
        setBioHint(`Tocca ${capability?.label || 'Biometria'} per sbloccare subito`);
        return;
      }

      if (res.status === 'cancelled') {
        setBioHint(null);
        return;
      }

      if (res.status === 'not_enrolled') {
        setBioHint(null);
        if (!silentAuto) {
          setErrorMsg(
            `${capability?.label || 'Biometria'} non ancora attivo per ${
              promoterId === 'ciccio' ? 'Ciccio' : 'Lollo'
            }: accedi con il PIN per attivarlo.`
          );
        }
        return;
      }

      setBioHint(null);
      if (!silentAuto) {
        setErrorMsg(res.message);
      }
    },
    [bioBusy, loading, capability?.label, onAuthenticated]
  );

  // Immediately attempt Face ID / Android Biometrics as soon as the site opens (if enrolled on this device!)
  useEffect(() => {
    if (!capability?.supported) return;
    if (!hasLocalPasskey) return;
    if (autoTriedForRef.current === selectedId) return;
    autoTriedForRef.current = selectedId;

    const timer = window.setTimeout(() => {
      triggerBiometricUnlock(selectedId, true);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [capability?.supported, hasLocalPasskey, selectedId, triggerBiometricUnlock]);

  const attemptPinLogin = useCallback(
    async (candidatePin: string) => {
      if (loading) return;
      setLoading(true);
      setErrorMsg(null);
      try {
        const { error } = await supabase.auth.signInWithPassword({
          email: account.email,
          password: candidatePin,
        });
        if (error) {
          setShakeKey((k) => k + 1);
          setPin('');
          setErrorMsg('Codice non valido. Riprova.');
          setLoading(false);
          return;
        }
        try {
          localStorage.setItem('lc_last_user', account.promoterId);
        } catch {
          // ignore
        }
        markSessionUnlockedThisVisit(true);
        onAuthenticated('pin', account.promoterId);
      } catch {
        setShakeKey((k) => k + 1);
        setPin('');
        setErrorMsg('Connessione non riuscita. Verifica la rete.');
        setLoading(false);
      }
    },
    [account.email, account.promoterId, loading, onAuthenticated]
  );

  const pushDigit = useCallback(
    (digit: string) => {
      if (loading || bioBusy) return;
      setErrorMsg(null);
      setBioHint(null);
      setPin((prev) => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + digit;
        if (next.length === PIN_LENGTH) {
          window.setTimeout(() => attemptPinLogin(next), 90);
        }
        return next;
      });
    },
    [loading, bioBusy, attemptPinLogin]
  );

  const popDigit = useCallback(() => {
    if (loading || bioBusy) return;
    setErrorMsg(null);
    setPin((prev) => prev.slice(0, -1));
  }, [loading, bioBusy]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        pushDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        popDigit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pushDigit, popDigit]);

  const keypadRows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
  ];

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-5 py-6 select-none"
      style={{ backgroundColor: 'var(--bg-canvas)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={APPLE_SPRING}
        className="w-full max-w-[360px] flex flex-col items-center"
      >
        {/* Minimal Brand Mark (clickable for Face ID when available!) */}
        <button
          type="button"
          disabled={!showBioButton || bioBusy || loading}
          onClick={() => triggerBiometricUnlock(selectedId, false)}
          aria-label={showBioButton ? `Sblocca con ${capability?.label}` : 'Lollo & Ciccio'}
          className="mb-4 flex h-14 w-14 items-center justify-center rounded-[16px] apple-press cursor-pointer disabled:cursor-default"
          style={{
            backgroundColor: hasLocalPasskey ? 'var(--accent-subtle)' : 'var(--bg-surface)',
            boxShadow: 'var(--shadow-card)',
            color: 'var(--accent)',
          }}
        >
          {showBioButton && hasLocalPasskey ? (
            <BioIcon className="h-7 w-7" aria-hidden="true" />
          ) : (
            <Lock className="h-6 w-6" aria-hidden="true" />
          )}
        </button>

        <h1 className="text-[24px] font-bold tracking-tight text-center">Lollo &amp; Ciccio</h1>
        <p className="mt-1 text-[14px] text-center" style={{ color: 'var(--ink-secondary)' }}>
          {hasLocalPasskey && showBioButton
            ? `Usa ${capability?.label} oppure inserisci il codice`
            : 'Seleziona il profilo e inserisci il codice a 6 cifre'}
        </p>

        {/* Account Switcher */}
        <div
          className="mt-5 grid w-full grid-cols-2 gap-1.5 rounded-[14px] p-1.5"
          style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
        >
          {TEAM_ACCOUNTS.map((acc) => {
            const active = acc.promoterId === selectedId;
            return (
              <button
                key={acc.promoterId}
                type="button"
                onClick={() => {
                  setSelectedId(acc.promoterId);
                  setPin('');
                  setErrorMsg(null);
                  setBioHint(null);
                }}
                className="relative flex items-center justify-center gap-2.5 rounded-[10px] py-2.5 px-3 text-[14px] font-semibold cursor-pointer apple-press"
                style={{
                  color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                }}
              >
                {active && (
                  <motion.span
                    layoutId="lock-profile-pill"
                    transition={APPLE_SPRING_SNAPPY}
                    className="absolute inset-0 rounded-[10px]"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.08), 0 0 0 0.5px rgba(0,0,0,0.05)',
                    }}
                  />
                )}
                <span
                  className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: acc.color }}
                >
                  {acc.initials}
                </span>
                <span className="relative z-10">{acc.displayName}</span>
              </button>
            );
          })}
        </div>

        {/* Prominent Apple Face ID / Android Biometric Pill when enrolled */}
        {showBioButton && hasLocalPasskey && (
          <button
            type="button"
            disabled={bioBusy || loading}
            onClick={() => triggerBiometricUnlock(selectedId, false)}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-[13px] py-3 px-4 text-[15px] font-semibold text-white apple-press cursor-pointer disabled:opacity-60"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <BioIcon className="h-5 w-5" aria-hidden="true" />
            {bioBusy ? 'Verifica in corso…' : `Sblocca con ${capability?.label}`}
          </button>
        )}

        {/* Passcode Dots */}
        <motion.div
          key={shakeKey}
          animate={shakeKey > 0 ? { x: [0, -10, 10, -7, 7, -3, 3, 0] } : { x: 0 }}
          transition={{ duration: 0.36 }}
          className="mt-6 mb-2 flex items-center gap-4"
          aria-live="polite"
          aria-label={`Inserite ${pin.length} cifre su ${PIN_LENGTH}`}
        >
          {Array.from({ length: PIN_LENGTH }).map((_, i) => {
            const filled = i < pin.length;
            return (
              <motion.span
                key={i}
                animate={{ scale: filled ? 1.1 : 1 }}
                transition={APPLE_SPRING_SNAPPY}
                className="h-3.5 w-3.5 rounded-full transition-colors duration-150"
                style={{
                  backgroundColor: filled ? 'var(--ink-primary)' : 'transparent',
                  border: `1.5px solid ${filled ? 'var(--ink-primary)' : 'var(--separator-strong)'}`,
                }}
              />
            );
          })}
        </motion.div>

        <div className="min-h-[24px] px-2 flex items-center justify-center text-center">
          {loading || bioBusy ? (
            <span className="text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              {bioBusy ? `Verifica ${capability?.label}…` : 'Accesso in corso…'}
            </span>
          ) : errorMsg ? (
            <span className="text-[13px] font-medium" style={{ color: 'var(--status-red)' }}>
              {errorMsg}
            </span>
          ) : bioHint ? (
            <span className="text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
              {bioHint}
            </span>
          ) : (
            <span className="text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
              Inserisci il codice a 6 cifre
            </span>
          )}
        </div>

        {/* Apple Numeric Keypad (with native Face ID / Fingerprint button in bottom-left slot!) */}
        <div className="mt-3.5 grid grid-cols-3 gap-x-6 gap-y-3">
          {keypadRows.flat().map((digit) => (
            <button
              key={digit}
              type="button"
              disabled={loading || bioBusy}
              onClick={() => pushDigit(digit)}
              className="flex h-[66px] w-[66px] items-center justify-center rounded-full text-[26px] font-medium tabular-nums apple-surface apple-press cursor-pointer disabled:opacity-45 hover:brightness-[0.98] dark:hover:brightness-110"
            >
              {digit}
            </button>
          ))}

          {/* Bottom-left: Biometric trigger button (iOS & Android standard placement) */}
          {showBioButton ? (
            <button
              type="button"
              disabled={loading || bioBusy}
              onClick={() => triggerBiometricUnlock(selectedId, false)}
              aria-label={`Sblocca con ${capability?.label}`}
              title={`Sblocca con ${capability?.label}`}
              className="flex h-[66px] w-[66px] items-center justify-center rounded-full apple-press cursor-pointer disabled:opacity-40"
              style={{ color: 'var(--accent)' }}
            >
              <BioIcon className="h-7 w-7" aria-hidden="true" />
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            disabled={loading || bioBusy}
            onClick={() => pushDigit('0')}
            className="flex h-[66px] w-[66px] items-center justify-center rounded-full text-[26px] font-medium tabular-nums apple-surface apple-press cursor-pointer disabled:opacity-45 hover:brightness-[0.98] dark:hover:brightness-110"
          >
            0
          </button>

          <button
            type="button"
            disabled={loading || bioBusy || pin.length === 0}
            onClick={popDigit}
            aria-label="Cancella ultima cifra"
            className="flex h-[66px] w-[66px] items-center justify-center rounded-full apple-press cursor-pointer disabled:opacity-30"
            style={{ color: 'var(--ink-secondary)' }}
          >
            <Delete className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-6 text-[12px] text-center" style={{ color: 'var(--ink-tertiary)' }}>
          Passkey WebAuthn · Face ID &amp; Biometria Android
        </p>
      </motion.div>
    </div>
  );
}
