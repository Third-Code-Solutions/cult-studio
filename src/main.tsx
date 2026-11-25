import * as Sentry from '@sentry/electron/renderer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Events go to the main process over IPC (main holds the DSN and scrubs). No Node or network access needed here.
if (import.meta.env.VITE_SENTRY_DSN) Sentry.init();
document.documentElement.dataset.platform = window.cult.platform; // per-OS title bar layout (styles.css)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
