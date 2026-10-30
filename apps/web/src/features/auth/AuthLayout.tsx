import { useEffect, useState, type ReactNode } from 'react';
import { Health } from '@between/contracts';
import { useServices } from '../../app/context';
import { DevBadge, Notice } from '../../components/ui';
import { supabaseConfigured } from '../../lib/config';

/** The only role=status element on auth pages (CI e2e relies on it). */
function ServerStatus() {
  const { mode } = useServices();
  const [text, setText] = useState('Проверяем соединение…');
  useEffect(() => {
    if (mode === 'fixtures') { setText('Сервер не используется: dev-режим фикстур'); return; }
    const controller = new AbortController();
    fetch('/api/health/live', { signal: controller.signal })
      .then(response => response.json())
      .then(data => { Health.parse(data); setText('Сервер доступен'); })
      .catch(() => { if (!controller.signal.aborted) setText('Сервер недоступен. Обновите страницу позже.'); });
    return () => controller.abort();
  }, [mode]);
  return <p className="server-status" role="status">{text}</p>;
}

export function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  const { mode } = useServices();
  return (
    <div className="auth-page">
      <header className="auth-brand">
        <p className="eyebrow">Тренажёр общения</p>
        <h1>Между строк</h1>
        <p className="tagline">Замечать сигналы. Проверять гипотезы. Подбирать слова.</p>
      </header>
      <main className="auth-card" id="main">
        {mode === 'fixtures' && <DevBadge>Вход и данные ненастоящие, письма не отправляются.</DevBadge>}
        {mode === 'http' && !supabaseConfigured && <Notice tone="error" title="Вход не настроен">Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY. Регистрация и вход недоступны.</Notice>}
        <h2>{title}</h2>
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </main>
      <ServerStatus />
    </div>
  );
}

export function PasswordToggle({ shown, onChange }: { shown: boolean; onChange(next: boolean): void }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={shown} onChange={event => onChange(event.target.checked)} /> Показать пароль
    </label>
  );
}
