import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// config must load first: it reads auth-link status from the URL before the SDK clears it.
import './lib/config';
import { loadServices } from './lib/services';
import { AppProviders } from './app/context';
import { App } from './app/App';
import './style.css';

const root = createRoot(document.getElementById('root')!);

async function start() {
  const services = await loadServices();
  const initial = await services.auth.init().catch(() => ({ user: null, recovery: false }));
  root.render(
    <StrictMode>
      <AppProviders services={services} initial={initial}>
        <App />
      </AppProviders>
    </StrictMode>,
  );
}

start().catch(() => {
  root.render(<main className="page page-narrow"><h1>Между строк</h1><p role="alert">Не удалось запустить приложение. Обновите страницу.</p></main>);
});
