import * as Sentry from '@sentry/browser';

window.Sentry = Sentry;

class CustomIntegration {
  constructor() {
    this.name = 'CustomIntegration';
  }

  setupOnce() {}
}

Sentry.onLoad(function () {
  Sentry.init({
    integrations: [new CustomIntegration()],
  });

  window.__sentryLoaded = true;
});
