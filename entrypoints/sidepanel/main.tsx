import { createRoot } from 'react-dom/client';
import { planTiles, stitchTiles } from '../../lib/fullpage';
import { rebuildLayout } from '../../lib/layout/rebuild';
import { getEngine } from '../../lib/ocr/engine';
import { prepareImage } from '../../lib/preprocess';
import { renderPage, runPipeline, runTiledPipeline } from '../../lib/pipeline';
import { coversFullFrame, filterPageByRegions } from '../../lib/layout/filter';
import { countTextTokens, warmTokenizer } from '../../lib/tokens';
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
      runPipeline: typeof runPipeline;
      runTiledPipeline: typeof runTiledPipeline;
      renderPage: typeof renderPage;
      prepareImage: typeof prepareImage;
      getEngine: typeof getEngine;
      countTextTokens: typeof countTextTokens;
      warmTokenizer: typeof warmTokenizer;
      filterPageByRegions: typeof filterPageByRegions;
      coversFullFrame: typeof coversFullFrame;
    };
  }
}

// The e2e test and the timing benchmark drive the real pipeline through this
// hook. It is only attached when the panel is opened with ?debug=1, so a normal
// panel has no globals.
if (new URLSearchParams(window.location.search).has('debug')) {
  window.__sttDebug = {
    planTiles,
    stitchTiles,
    rebuildLayout,
    runPipeline,
    runTiledPipeline,
    renderPage,
    prepareImage,
    getEngine,
    countTextTokens,
    warmTokenizer,
    filterPageByRegions,
    coversFullFrame,
  };
}

createRoot(container).render(<App />);
