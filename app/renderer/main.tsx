import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';
if (import.meta.env.DEV && new URLSearchParams(location.search).has('preview')) {
  await import('./preview');
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
