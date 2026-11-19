import React, { useEffect, useId, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Minus, Plus, X } from 'lucide-react';

export const APPLE_SPRING = {
  type: 'spring' as const,
  bounce: 0,
  duration: 0.34,
};

export const APPLE_SPRING_SNAPPY = {
  type: 'spring' as const,
  bounce: 0,
  duration: 0.24,
};

/**
 * Apple Segmented Control with fluid sliding pill (layoutId spring).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  ariaLabel,
  className = '',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (val: T) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
  className?: string;
}) {
  const groupId = useId();
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`inline-flex items-center rounded-[10px] p-[3px] select-none ${className}`}
      style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`relative flex-1 rounded-[7px] font-medium transition-colors apple-press cursor-pointer whitespace-nowrap ${
              size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[13px]'
            }`}
            style={{
              color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            }}
          >
            {active && (
              <motion.span
                layoutId={`seg-${groupId}`}
                transition={APPLE_SPRING_SNAPPY}
                className="absolute inset-0 rounded-[7px]"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.09), 0 0 0 0.5px rgba(0,0,0,0.05)',
                }}
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Native iOS-style Switch with spring thumb animation.
 */
export function AppleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[28px] w-[48px] shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 cursor-pointer disabled:opacity-45"
      style={{
        backgroundColor: checked ? '#34C759' : 'var(--bg-surface-tertiary)',
      }}
    >
      <motion.span
        layout
        transition={APPLE_SPRING_SNAPPY}
        className="block h-[24px] w-[24px] rounded-full bg-white"
        style={{
          marginLeft: checked ? '20px' : '0px',
          boxShadow: '0 2px 5px rgba(0,0,0,0.18), 0 0 1px rgba(0,0,0,0.1)',
        }}
      />
    </button>
  );
}

/**
 * Numeric input with local draft string so Italian commas/decimals and clearing
 * never cause cursor jumping, committing cleanly on blur or Enter.
 */
export function NumericCellInput({
  value,
  onCommit,
  integer = false,
  allowNegative = false,
  prefix,
  placeholder = '0',
  ariaLabel,
  className = '',
  align = 'right',
}: {
  value: number;
  onCommit: (val: number) => void;
  integer?: boolean;
  allowNegative?: boolean;
  prefix?: string;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  align?: 'left' | 'right' | 'center';
}) {
  const formatDraft = (n: number) => {
    if (!n && n !== 0) return '';
    if (n === 0) return '';
    return String(n).replace('.', ',');
  };

  const [draft, setDraft] = useState<string>(() => formatDraft(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(formatDraft(value));
    }
  }, [value, focused]);

  const commit = (raw: string) => {
    const cleaned = raw.trim().replace(',', '.');
    if (cleaned === '' || cleaned === '-') {
      if (value !== 0) onCommit(0);
      setDraft('');
      return;
    }
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) {
      setDraft(formatDraft(value));
      return;
    }
    let finalVal = integer ? Math.round(parsed) : Math.round(parsed * 100) / 100;
    if (!allowNegative && finalVal < 0) finalVal = 0;
    if (finalVal !== value) onCommit(finalVal);
    setDraft(formatDraft(finalVal));
  };

  return (
    <div className={`relative flex items-center ${className}`}>
      {prefix && (
        <span
          className="pointer-events-none absolute left-2 text-[12px] select-none"
          style={{ color: 'var(--ink-tertiary)' }}
        >
          {prefix}
        </span>
      )}
      <input
        type="text"
        inputMode={integer ? (allowNegative ? 'text' : 'numeric') : 'decimal'}
        aria-label={ariaLabel}
        value={draft}
        placeholder={placeholder}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          const val = e.target.value;
          const pattern = allowNegative
            ? integer
              ? /^-?\d*$/
              : /^-?\d*[.,]?\d*$/
            : integer
              ? /^\d*$/
              : /^\d*[.,]?\d*$/;
          if (pattern.test(val)) {
            setDraft(val);
          }
        }}
        onBlur={() => {
          setFocused(false);
          commit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(formatDraft(value));
            e.currentTarget.blur();
          }
        }}
        className={`apple-input w-full rounded-[8px] py-1.5 text-[16px] md:text-[14px] font-medium tabular-nums ${
          prefix ? 'pl-6 pr-2' : 'px-2.5'
        } ${
          align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
        }`}
      />
    </div>
  );
}

/**
 * Apple iOS Stepper (− / value / +) for one-thumb rapid counting on phone.
 */
export function AppleStepper({
  value,
  onChange,
  min = 0,
  step = 1,
  label,
  size = 'md',
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  step?: number;
  label: string;
  size?: 'sm' | 'md';
}) {
  const btnCls =
    size === 'sm' ? 'h-8 w-8 text-[14px]' : 'h-10 w-10 text-[16px]';

  return (
    <div
      className="inline-flex items-center rounded-[10px] p-0.5 select-none"
      style={{ backgroundColor: 'var(--bg-surface-secondary)' }}
      aria-label={label}
    >
      <button
        type="button"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
        aria-label={`Riduci ${label}`}
        className={`flex ${btnCls} items-center justify-center rounded-[8px] apple-press cursor-pointer disabled:opacity-30`}
        style={{
          backgroundColor: 'var(--bg-surface)',
          color: 'var(--ink-primary)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        }}
      >
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        className={`tabular-nums font-semibold text-center ${
          size === 'sm' ? 'min-w-[34px] text-[14px]' : 'min-w-[44px] text-[16px]'
        }`}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + step)}
        aria-label={`Aumenta ${label}`}
        className={`flex ${btnCls} items-center justify-center rounded-[8px] apple-press cursor-pointer`}
        style={{
          backgroundColor: 'var(--bg-surface)',
          color: 'var(--accent)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
        }}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Apple Modal / Bottom Sheet (centered modal on desktop, spring sheet on mobile).
 */
export function AppleModal({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-[480px]',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/35 backdrop-blur-[4px]"
          />
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={APPLE_SPRING}
            className={`relative z-10 w-full ${maxWidth} max-h-[90dvh] flex flex-col rounded-t-[22px] sm:rounded-[20px] overflow-hidden overscroll-contain`}
            style={{
              backgroundColor: 'var(--bg-surface)',
              boxShadow: 'var(--shadow-floating)',
            }}
          >
            <div
              className="flex items-start justify-between gap-3 px-5 pt-5 pb-3.5 shrink-0"
              style={{ borderBottom: '0.5px solid var(--separator)' }}
            >
              <div className="min-w-0">
                <h2 className="text-[18px] font-semibold tracking-tight">{title}</h2>
                {subtitle && (
                  <p className="mt-0.5 text-[13px]" style={{ color: 'var(--ink-secondary)' }}>
                    {subtitle}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Chiudi"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full apple-press cursor-pointer"
                style={{
                  backgroundColor: 'var(--bg-surface-secondary)',
                  color: 'var(--ink-secondary)',
                }}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/**
 * Semantic traffic-light badge for Mancanti (mirrors the Google Sheet conditional formatting).
 */
export function MancantiBadge({ value, compact = false }: { value: number; compact?: boolean }) {
  const v = Math.round((Number(value) || 0) * 100) / 100;
  let bg = 'var(--status-green-bg)';
  let fg = 'var(--status-green)';
  let label = compact ? 'Saldato' : '0\u00A0€ · Saldato';
  const hasCents = Math.abs(v - Math.round(v)) > 0.001;
  const formatted = v.toLocaleString('it-IT', {
    useGrouping: 'always',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  });

  if (v > 0.005) {
    bg = 'var(--status-red-bg)';
    fg = 'var(--status-red)';
    label = `${formatted}\u00A0€`;
  } else if (v < -0.005) {
    bg = 'var(--status-orange-bg)';
    fg = 'var(--status-orange)';
    label = `${formatted}\u00A0€`;
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold tabular-nums whitespace-nowrap"
      style={{ backgroundColor: bg, color: fg }}
    >
      {label}
    </span>
  );
}
