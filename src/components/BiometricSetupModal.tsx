import { useState } from 'react';
import { Fingerprint, ScanFace } from 'lucide-react';
import { toast } from 'sonner';
import { AppleModal } from './ui/AppleControls';
import {
  enrollDeviceBiometrics,
  setBiometricPromptDismissed,
  type BiometricCapability,
} from '../lib/biometrics';

export function BiometricSetupModal({
  open,
  onClose,
  promoterId,
  displayName,
  capability,
  onEnrolled,
}: {
  open: boolean;
  onClose: () => void;
  promoterId: string;
  displayName: string;
  capability: BiometricCapability;
  onEnrolled: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const isFaceId = capability.platform === 'ios';
  const Icon = isFaceId ? ScanFace : Fingerprint;

  const handleEnable = async () => {
    setBusy(true);
    try {
      await enrollDeviceBiometrics(promoterId);
      toast.success(`${capability.label} attivato su ${capability.deviceName}`);
      onEnrolled();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Attivazione non completata';
      if (!msg.toLowerCase().includes('annullat') && !msg.toLowerCase().includes('abort')) {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    setBiometricPromptDismissed(promoterId, true);
    onClose();
  };

  return (
    <AppleModal
      open={open}
      onClose={handleDismiss}
      title={`Sblocca con ${capability.label}`}
      maxWidth="max-w-[400px]"
    >
      <div className="flex flex-col items-center text-center pt-1 pb-2 space-y-4">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-[20px]"
          style={{
            backgroundColor: 'var(--accent-subtle)',
            color: 'var(--accent)',
          }}
        >
          <Icon className="h-9 w-9" aria-hidden="true" />
        </div>

        <div className="space-y-1.5">
          <p className="text-[15px] font-medium">
            Accedi come <strong>{displayName}</strong> senza digitare ogni volta il codice a 6 cifre.
          </p>
          <p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
            All’apertura del sito l’app richiederà automaticamente {capability.label} sul tuo{' '}
            {capability.deviceName} (con codice PIN sempre disponibile come alternativa).
          </p>
        </div>

        <div className="w-full flex flex-col gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleEnable}
            className="w-full inline-flex items-center justify-center gap-2 rounded-[12px] py-3 px-4 text-[15px] font-semibold text-white apple-press cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            {busy ? 'Verifica in corso…' : `Attiva ${capability.label}`}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={handleDismiss}
            className="w-full rounded-[12px] py-2.5 px-4 text-[14px] font-medium apple-press cursor-pointer"
            style={{
              backgroundColor: 'var(--bg-surface-secondary)',
              color: 'var(--ink-secondary)',
            }}
          >
            Non ora
          </button>
        </div>
      </div>
    </AppleModal>
  );
}
