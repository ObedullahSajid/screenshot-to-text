/**
 * Counts tokens off the panel's main thread.
 *
 * Parsing the ~2 MB GPT-4o vocabulary takes a few hundred milliseconds on a
 * fast machine and seconds on a slow one. Doing it here keeps the panel
 * responsive while the work happens, whether the vocabulary is warmed at idle
 * or loaded on the first result.
 */
import { countTokens } from 'gpt-tokenizer/model/gpt-4o';

interface Request {
  id: number;
  text: string;
}

interface Response {
  id: number;
  count: number;
}

// The file has no DOM lib at build time, so the worker scope is described by
// hand instead of pulling in the WebWorker lib alongside DOM.
const scope = self as unknown as {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<Request>) => void,
  ) => void;
  postMessage: (message: Response) => void;
};

scope.addEventListener('message', (event) => {
  const { id, text } = event.data;
  scope.postMessage({ id, count: countTokens(text) });
});
