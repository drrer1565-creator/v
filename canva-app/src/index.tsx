import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppUiProvider } from '@canva/app-ui-kit';
import '@canva/app-ui-kit/styles.css';
import { App } from './app';

const rootEl = document.getElementById('root') || document.body.appendChild(document.createElement('div'));
rootEl.id = 'root';

createRoot(rootEl).render(
  <React.StrictMode>
    <AppUiProvider>
      <App />
    </AppUiProvider>
  </React.StrictMode>
);
