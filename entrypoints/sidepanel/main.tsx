import { createRoot } from 'react-dom/client';
import { planTiles, stitchTiles } from '../../lib/fullpage';
import { rebuildLayout } from '../../lib/layout/rebuild';
import { runTiledPipeline } from '../../lib/pipeline';
import App from './App';
import './style.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

declare global {
  interface Window {
    __sttDebug?: {
      planTiles: typeof planTiles;
      stitchTiles: typeof stitchTiles;
      rebuildLayout: typeof rebuildLayout;
      runTiledPipeline: typeof runTiledPipeline;
    };
  }
}

// The e2e test drives the tiling maths through this hook. It is only attached
// when the panel is opened with ?debug=1, so a normal panel has no globals.
if (new URLSearchParams(window.location.search).has('debug')) {
  window.__sttDebug = { planTiles, stitchTiles, rebuildLayout, runTiledPipeline };
}

createRoot(container).render(<App />);
