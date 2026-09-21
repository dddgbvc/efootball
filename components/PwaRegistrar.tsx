'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker and, crucially, refuses to let an old one stay
 * in charge.
 *
 * The usual PWA failure is a worker that installs once and then serves the
 * same build forever. Here a waiting worker is told to activate immediately
 * and the page reloads once under the new one, so a deploy reaches people on
 * their next visit rather than whenever their browser feels like it.
 */
export function PwaRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    /*
     * Reload only when a *new* worker replaces one that was already in charge.
     *
     * On a first visit `controller` is null and the very first worker takes
     * control moments after load. Reloading there throws away whatever the
     * person was in the middle of — a half-filled sign-in form, most
     * obviously — for no benefit, since the page is already the newest build.
     */
    const hadController = navigator.serviceWorker.controller !== null;
    let reloading = false;
    const onControllerChange = () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const promote = (registration: ServiceWorkerRegistration | undefined) => {
      registration?.waiting?.postMessage('SKIP_WAITING');
    };

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        // Some environments — locked-down browsers, automation with workers
        // disabled — resolve this with nothing. Reading through it throws
        // inside an effect, which takes the whole page's interactivity with
        // it: the registration is a nicety, the page is not.
        if (!registration) return;

        promote(registration);
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              promote(registration);
            }
          });
        });
      })
      .catch((error) => {
        // Registration fails on http:// and in some private modes. The app
        // works without it; swallowing the reason would not help anyone
        // debugging it, so it is reported.
        console.warn('[pwa] service worker registration failed', error);
      });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
