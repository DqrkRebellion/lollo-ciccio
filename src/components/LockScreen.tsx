import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Delete, Lock } from 'lucide-react';
import { supabase, TEAM_ACCOUNTS } from '../lib/supabase';
import { APPLE_SPRING, APPLE_SPRING_SNAPPY } from './ui/AppleControls';

const PIN_LENGTH = 6;

export function LockScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

  const account = TEAM_ACCOUNTS.find((a) => a.promoterId === selectedId) || TEAM_ACCOUNTS[0];

  const attemptLogin = useCallback(
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
        onAuthenticated();
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
      if (loading) return;
      setErrorMsg(null);
      setPin((prev) => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + digit;
        if (next.length === PIN_LENGTH) {
          window.setTimeout(() => attemptLogin(next), 90);
        }
        return next;
      });
    },
    [loading, attemptLogin]
  );

  const popDigit = useCallback(() => {
    if (loading) return;
    setErrorMsg(null);
    setPin((prev) => prev.slice(0, -1));
  }, [loading]);

  // Keyboard support (digits + Backspace + Enter)
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
      className="min-h-dvh flex flex-col items-center justify-center px-5 py-8 select-none"
      style={{ backgroundColor: 'var(--bg-canvas)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={APPLE_SPRING}
        className="w-full max-w-[360px] flex flex-col items-center"
      >
        {/* Minimal Brand Mark */}
        <div
          className="mb-5 flex h-14 w-14 items-center justify-center rounded-[16px]"
          style={{
            backgroundColor: 'var(--bg-surface)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <Lock className="h-6 w-6" style={{ color: 'var(--accent)' }} aria-hidden="true" />
        </div>

        <h1 className="text-[24px] font-bold tracking-tight text-center">Lollo &amp; Ciccio</h1>
        <p className="mt-1 text-[14px] text-center" style={{ color: 'var(--ink-secondary)' }}>
          Seleziona il profilo e inserisci il codice a 6 cifre
        </p>

        {/* Account Switcher */}
        <div
          className="mt-6 grid w-full grid-cols-2 gap-1.5 rounded-[14px] p-1.5"
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

        {/* Passcode Dots */}
        <motion.div
          key={shakeKey}
          animate={
            shakeKey > 0
              ? { x: [0, -10, 10, -7, 7, -3, 3, 0] }
              : { x: 0 }
          }
          transition={{ duration: 0.36 }}
          className="mt-7 mb-2 flex items-center gap-4"
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

        <div className="h-6 flex items-center justify-center">
          {loading ? (
            <span className="text-[13px] font-medium" style={{ color: 'var(--ink-secondary)' }}>
              Accesso in corso…
            </span>
          ) : errorMsg ? (
            <span className="text-[13px] font-medium" style={{ color: 'var(--status-red)' }}>
              {errorMsg}
            </span>
          ) : (
            <span className="text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>
              Puoi usare anche la tastiera numerica
            </span>
          )}
        </div>

        {/* Apple Numeric Keypad */}
        <div className="mt-4 grid grid-cols-3 gap-x-6 gap-y-3.5">
          {keypadRows.flat().map((digit) => (
            <button
              key={digit}
              type="button"
              disabled={loading}
              onClick={() => pushDigit(digit)}
              className="flex h-[68px] w-[68px] items-center justify-center rounded-full text-[26px] font-medium tabular-nums apple-surface apple-press cursor-pointer disabled:opacity-45 hover:brightness-[0.98] dark:hover:brightness-110"
            >
              {digit}
            </button>
          ))}
          <div />
          <button
            type="button"
            disabled={loading}
            onClick={() => pushDigit('0')}
            className="flex h-[68px] w-[68px] items-center justify-center rounded-full text-[26px] font-medium tabular-nums apple-surface apple-press cursor-pointer disabled:opacity-45 hover:brightness-[0.98] dark:hover:brightness-110"
          >
            0
          </button>
          <button
            type="button"
            disabled={loading || pin.length === 0}
            onClick={popDigit}
            aria-label="Cancella ultima cifra"
            className="flex h-[68px] w-[68px] items-center justify-center rounded-full apple-press cursor-pointer disabled:opacity-30"
            style={{ color: 'var(--ink-secondary)' }}
          >
            <Delete className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-7 text-[12px] text-center" style={{ color: 'var(--ink-tertiary)' }}>
          Sessione protetta · Dati sincronizzati in tempo reale
        </p>
      </motion.div>
    </div>
  );
}
