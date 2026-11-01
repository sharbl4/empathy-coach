import { useState, type ReactNode } from 'react';
import { Link, navigate, useLocation } from '../../app/router';
import { useServices } from '../../app/context';
import { Button, DevBadge, Notice } from '../../components/ui';
import { clearDrafts, hasUnsavedDrafts } from '../../lib/drafts';
import { useProfile } from './profile';

const sections = [
  { to: '/new', label: 'Новый разбор' },
  { to: '/history', label: 'История', also: '/sessions/' },
  { to: '/practice', label: 'Практика' },
  { to: '/settings', label: 'Настройки' },
];

export function Shell({ children }: { children: ReactNode }) {
  const { auth, mode } = useServices();
  const { me, error, reload, loading } = useProfile();
  const { pathname } = useLocation();
  const [leaving, setLeaving] = useState(false);

  async function signOut() {
    if (hasUnsavedDrafts() && !window.confirm('Несохранённый текст в этой вкладке будет удалён. Выйти?')) return;
    setLeaving(true);
    clearDrafts();
    try { await auth.signOut(); } catch { /* local session is cleared by the SDK even if the network call fails */ }
    navigate('/auth/login?signedOut=1', { replace: true, force: true });
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">К содержимому</a>
      <header className="shell-header">
        <div className="shell-top">
          <Link to="/history" className="brand">Между строк</Link>
          <div className="shell-user">
            {me && <span className="user-name" title="Имя в приложении">{me.displayName}</span>}
            <Button variant="ghost" onClick={signOut} busy={leaving}>Выйти</Button>
          </div>
        </div>
        <nav aria-label="Разделы кабинета">
          <ul className="nav">
            {sections.map(section => {
              const active = pathname === section.to || (section.also !== undefined && pathname.startsWith(section.also));
              return <li key={section.to}><Link to={section.to} aria-current={active ? 'page' : undefined}>{section.label}</Link></li>;
            })}
          </ul>
        </nav>
      </header>
      {mode === 'fixtures' && <DevBadge>Данные подготовлены заранее и хранятся только в памяти вкладки. Ответы не зависят от вашего текста.</DevBadge>}
      {me?.aiMode === 'mock' && mode === 'http' && (
        <Notice tone="dev" title="Демо-режим сервера">Разборы берутся из подготовленных примеров, а не из живой модели.</Notice>
      )}
      {error && !loading && (
        <div className="shell-notice"><Notice tone="error" title="Не удалось загрузить профиль" action={<Button variant="secondary" onClick={reload}>Повторить</Button>}>{error}</Notice></div>
      )}
      <main id="main" className="shell-main" tabIndex={-1}>{children}</main>
    </div>
  );
}
