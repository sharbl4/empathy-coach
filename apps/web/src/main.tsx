// Must run first: takes the one-time token out of the URL fragment before anything else can read or log it.
import './lib/connectToken';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './app/App';
import {SessionProvider} from './lib/session';
import './style.css';

createRoot(document.getElementById('root')!).render(<StrictMode><SessionProvider><App/></SessionProvider></StrictMode>);
