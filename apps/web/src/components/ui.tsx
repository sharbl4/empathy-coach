import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

export function Button({ busy, variant = 'primary', children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button type="button" className={`btn btn-${variant}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

interface FieldShell { label: string; hint?: ReactNode; error?: string | null; counter?: { value: number; max: number }; }

function FieldFrame({ id, label, hint, error, counter, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={`field${error ? ' field-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
      {children}
      <div className="field-meta">
        {error ? <p className="field-error" id={`${id}-error`}>{error}</p> : <span />}
        {counter && <span className={`counter${counter.value > counter.max ? ' counter-over' : ''}`}>{counter.value} / {counter.max}</span>}
      </div>
    </div>
  );
}

const describedBy = (id: string, hint: unknown, error: unknown) => [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

export function TextField({ label, hint, error, counter, ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} counter={counter}>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
    </FieldFrame>
  );
}

export function TextArea({ label, hint, error, counter, ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} counter={counter}>
      <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
    </FieldFrame>
  );
}

/** Errors use role=alert. role=status is reserved for the single server-status line. */
export function Notice({ tone = 'info', title, children, action }: { tone?: 'info' | 'error' | 'success' | 'dev'; title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : undefined} aria-live={tone === 'error' ? undefined : 'polite'}>
      {title && <p className="notice-title">{title}</p>}
      {children && <div className="notice-body">{children}</div>}
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return <p className="loading" aria-live="polite"><span className="spinner" aria-hidden="true" />{label}</p>;
}

export function DevBadge({ children }: { children: ReactNode }) {
  return <p className="dev-banner"><strong>DEV · фикстуры</strong> {children}</p>;
}
