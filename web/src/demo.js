// True in the online demo build (web/demo/build.mjs), where the server runs in this browser.
/* global __ZB_DEMO__ */
export const DEMO = typeof __ZB_DEMO__ !== 'undefined' && __ZB_DEMO__ === true;
export const REPO_URL = 'https://github.com/endiluong/zboard';

// Forget everything in this browser and start again with an empty Home board.
export async function resetDemo() {
  const sw = navigator.serviceWorker?.controller;
  if (sw) {
    await new Promise((resolve) => {
      const done = (e) => e.data?.type === 'reset-done' && (navigator.serviceWorker.removeEventListener('message', done), resolve());
      navigator.serviceWorker.addEventListener('message', done);
      sw.postMessage({ type: 'reset' });
      setTimeout(resolve, 3000);
    });
  }
  location.hash = '';
  location.reload();
}
