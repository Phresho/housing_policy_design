import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
// After a new build (deploy) an open tab still asks for the old lazy chunks (Plotly for the Bode and robustness
// plots), which no longer exist: reload once to get the new build. The guard stops a reload loop.
window.addEventListener('vite:preloadError', e => {
  try { if (sessionStorage.getItem('chunk-reload')) return; sessionStorage.setItem('chunk-reload', '1'); } catch { return; }
  e.preventDefault(); window.location.reload();
});
try { window.setTimeout(() => sessionStorage.removeItem('chunk-reload'), 10000); } catch { /* no storage */ }
createRoot(document.getElementById('root')!).render(<App/>);
// Load Plotly in the background soon after start, so a later first plot (Identify system, Bode, robustness) never
// asks the server for a chunk that a new build has replaced (that forced a page reload).
window.setTimeout(() => { void import('plotly.js-dist-min').catch(() => undefined); }, 1500);
