import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  RefreshCw,
  Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppleModal } from './ui/AppleControls';
import { supabase } from '../lib/supabase';
import type { TicketSmsSyncStatus } from '../types/ticketsms';

function formatSyncTimeIt(iso: string | null | undefined): string {
  if (!iso) return 'In attesa';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'In attesa';
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function TicketSmsIosModal({
  open,
  onClose,
  syncStatus,
  onRefreshNow,
}: {
  open: boolean;
  onClose: () => void;
  syncStatus: TicketSmsSyncStatus | null;
  onRefreshNow: () => Promise<void> | void;
}) {
  const [scriptText, setScriptText] = useState<string | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showRawFallback, setShowRawFallback] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Prefetch personalized iOS Shortcut JS as soon as the modal opens so
  // navigator.clipboard.writeText() runs SYNCHRONOUSLY inside the tap gesture on iOS Safari!
  useEffect(() => {
    if (!open || scriptText) return;
    let cancelled = false;
    setScriptLoading(true);
    setScriptError(null);
    supabase.functions
      .invoke('ingest-ticketsms-sync', { body: { action: 'get_ios_script' } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setScriptError(error.message || 'Impossibile caricare lo script');
        } else if (data && typeof data === 'object' && 'script' in data && data.script) {
          setScriptText(String(data.script));
        } else {
          setScriptError('Risposta non valida dal server');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setScriptError(err instanceof Error ? err.message : 'Errore caricamento script');
        }
      })
      .finally(() => {
        if (!cancelled) setScriptLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, scriptText]);

  const handleCopyScript = async () => {
    if (!scriptText) return;
    try {
      await navigator.clipboard.writeText(scriptText);
      setCopied(true);
      toast.success('Script copiato! Ora incollalo in Comandi Rapidi su iPhone');
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setShowRawFallback(true);
      toast.error('Tocca il riquadro qui sotto per selezionare e copiare lo script');
    }
  };

  const handleRefreshApp = async () => {
    setRefreshing(true);
    try {
      await onRefreshNow();
      toast.success('Dati ricaricati dal cloud');
    } finally {
      setRefreshing(false);
    }
  };

  const statusColor =
    syncStatus?.status === 'session_expired'
      ? 'var(--status-orange)'
      : syncStatus?.status === 'error'
        ? 'var(--status-red)'
        : 'var(--status-green)';

  return (
    <AppleModal
      open={open}
      onClose={onClose}
      title="Aggiorna TicketSMS"
      subtitle="Sincronizzazione rapida per Lollo tramite Comando Rapido iOS (senza cookie né PC)"
      maxWidth="max-w-[520px]"
    >
      <div className="space-y-4">
        {/* Status strip */}
        <div
          className="flex items-center justify-between gap-3 rounded-[12px] px-3.5 py-2.5"
          style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: statusColor }}
                aria-hidden="true"
              />
              <span>Ultimo sync: {formatSyncTimeIt(syncStatus?.synced_at)}</span>
            </div>
            {syncStatus?.message && (
              <p
                className="mt-0.5 text-[12px] truncate"
                style={{ color: 'var(--ink-secondary)' }}
              >
                {syncStatus.message}
              </p>
            )}
          </div>

          <button
            type="button"
            disabled={refreshing}
            onClick={handleRefreshApp}
            className="inline-flex items-center gap-1 rounded-[9px] px-2.5 py-1.5 text-[12px] font-semibold apple-surface apple-press cursor-pointer shrink-0 disabled:opacity-50"
            style={{ color: 'var(--ink-primary)' }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            Ricarica
          </button>
        </div>

        {/* Primary 1-tap action: Open TicketSMS in Safari */}
        <div className="space-y-2">
          <a
            href="https://my.ticketsms.it/ListEvent.php?active=true"
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-[12px] px-4 py-3 text-[15px] font-semibold text-white apple-press"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Apri TicketSMS su Safari
          </a>
          <p className="text-center text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
            Su Safari tocca <strong>Condividi</strong> → <strong>Aggiorna TicketSMS</strong>:
            aggiorna Lollo e Reverse in 2 secondi e ti riporta qui.
          </p>
        </div>

        {/* First-time iOS Shortcut Setup Accordion */}
        <div
          className="rounded-[14px] overflow-hidden"
          style={{
            border: '0.5px solid var(--separator)',
            backgroundColor: 'var(--bg-surface)',
          }}
        >
          <button
            type="button"
            onClick={() => setShowSetup((s) => !s)}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
          >
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
              <Smartphone className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
              Configura Comando Rapido iOS (solo la 1ª volta)
            </span>
            {showSetup ? (
              <ChevronUp className="h-4 w-4 shrink-0" style={{ color: 'var(--ink-tertiary)' }} aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0" style={{ color: 'var(--ink-tertiary)' }} aria-hidden="true" />
            )}
          </button>

          {showSetup && (
            <div
              className="px-4 pb-4 pt-3 space-y-3.5 text-[13px]"
              style={{ borderTop: '0.5px solid var(--separator)' }}
            >
              <button
                type="button"
                disabled={scriptLoading || !scriptText}
                onClick={handleCopyScript}
                className="flex w-full items-center justify-center gap-2 rounded-[10px] px-3.5 py-2.5 text-[13px] font-semibold apple-press cursor-pointer disabled:opacity-50"
                style={{
                  backgroundColor: copied ? 'var(--status-green-bg)' : 'var(--accent-subtle)',
                  color: copied ? 'var(--status-green)' : 'var(--accent)',
                }}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Script copiato negli appunti!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                    {scriptLoading ? 'Preparazione script…' : 'Copia script Comando Rapido iOS'}
                  </>
                )}
              </button>

              {scriptError && (
                <p className="text-[12px]" style={{ color: 'var(--status-red)' }}>
                  {scriptError}
                </p>
              )}

              {showRawFallback && scriptText && (
                <textarea
                  readOnly
                  rows={4}
                  value={scriptText}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Script Comando Rapido iOS"
                  className="apple-input w-full rounded-[10px] p-2.5 text-[16px] md:text-[12px] font-mono"
                />
              )}

              <ol
                className="list-decimal pl-4 space-y-1.5 text-[12px] leading-relaxed"
                style={{ color: 'var(--ink-secondary)' }}
              >
                <li>
                  Su iPhone attiva una volta sola:{' '}
                  <strong style={{ color: 'var(--ink-primary)' }}>
                    Impostazioni → App → Comandi Rapidi → Avanzate → Consenti l’esecuzione di script
                  </strong>
                  .
                </li>
                <li>
                  Apri <strong style={{ color: 'var(--ink-primary)' }}>Comandi Rapidi</strong> → tocca{' '}
                  <strong style={{ color: 'var(--ink-primary)' }}>+</strong> → rinominalo{' '}
                  <strong style={{ color: 'var(--ink-primary)' }}>Aggiorna TicketSMS</strong> → tocca{' '}
                  <strong style={{ color: 'var(--ink-primary)' }}>(i)</strong> in basso e attiva{' '}
                  <strong style={{ color: 'var(--ink-primary)' }}>Mostra nel foglio di condivisione</strong>{' '}
                  (lascia <em>Pagine web Safari</em>).
                </li>
                <li>
                  Aggiungi l’azione{' '}
                  <strong style={{ color: 'var(--ink-primary)' }}>Esegui JavaScript su pagina web</strong>{' '}
                  (su <em>Input comando rapido</em>), cancella il codice di esempio e{' '}
                  <strong style={{ color: 'var(--ink-primary)' }}>incolla lo script copiato</strong>.
                </li>
                <li>
                  Aggiungi{' '}
                  <strong style={{ color: 'var(--ink-primary)' }}>Mostra notifica</strong> (con{' '}
                  <em>Risultato di JavaScript</em>) e, se vuoi tornare subito in app,{' '}
                  <strong style={{ color: 'var(--ink-primary)' }}>Apri URL</strong> →{' '}
                  <code className="text-[11px]">https://dqrkrebellion.github.io/lollo-ciccio/</code>.
                </li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </AppleModal>
  );
}
