import { useEffect, type ReactNode } from 'react';
import { matchPath, navigate, safeNext, useLocation } from './router';
import { useAuth } from './context';
import { AuthCallbackPage, CheckEmailPage, ForgotPasswordPage, LoginPage, RecoveryPage, SignupPage } from '../features/auth/pages';
import { ProfileProvider } from '../features/account/profile';
import { Shell } from '../features/account/Shell';
import { Placeholder } from '../features/account/placeholders';
import { HistoryPage } from '../features/sessions/HistoryPage';
import { NewSessionPage } from '../features/sessions/NewSessionPage';
import { SessionPage } from '../features/sessions/SessionPage';

function Redirect({ to }: { to: string }) {
  useEffect(() => { navigate(to, { replace: true, force: true }); }, [to]);
  return null;
}

const publicAuth: Record<string, () => ReactNode> = {
  '/auth/login': () => <LoginPage />,
  '/auth/signup': () => <SignupPage />,
  '/auth/check-email': () => <CheckEmailPage />,
  '/auth/forgot': () => <ForgotPasswordPage />,
};

interface CabinetRoute { pattern: string; render(params: Record<string, string>): ReactNode; }
const cabinet: CabinetRoute[] = [
  { pattern: '/new', render: () => <NewSessionPage /> },
  { pattern: '/history', render: () => <HistoryPage /> },
  // key: a different session id remounts the page, so no state or polling leaks between sessions.
  { pattern: '/sessions/:id', render: params => <SessionPage key={params.id} id={params.id} /> },
  { pattern: '/practice', render: () => <Placeholder title="Практика" text="Прогресс и практика — задача дня 2." /> },
  { pattern: '/settings', render: () => <Placeholder title="Настройки" text="Имя и удаление данных — задача дня 2." /> },
];

function NotFound() {
  return (
    <main className="page page-narrow" id="main">
      <h1>Страница не найдена</h1>
      <p><a href="/">На главную</a></p>
    </main>
  );
}

export function App() {
  const { pathname, search } = useLocation();
  const { user, recovery } = useAuth();

  // Auth-link targets work with or without a session: the guard must not swallow recovery.
  if (pathname === '/auth/recovery') return <RecoveryPage />;
  if (pathname === '/auth/callback') return <AuthCallbackPage />;
  if (user && recovery) return <Redirect to="/auth/recovery" />;

  const authPage = publicAuth[pathname];
  if (authPage) {
    if (user) return <Redirect to={safeNext(new URLSearchParams(search).get('next')) ?? '/history'} />;
    return <>{authPage()}</>;
  }

  if (pathname === '/') return <Redirect to={user ? '/history' : '/auth/login'} />;

  for (const route of cabinet) {
    const params = matchPath(route.pattern, pathname);
    if (!params) continue;
    if (!user) return <Redirect to={`/auth/login?next=${encodeURIComponent(pathname)}`} />;
    return (
      <ProfileProvider key={user.id}>
        <Shell>{route.render(params)}</Shell>
      </ProfileProvider>
    );
  }
  return <NotFound />;
}
