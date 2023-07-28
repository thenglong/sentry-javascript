import * as SentryBrowser from '@sentry/browser';

import { defaultIntegrations, init } from '../src/index';

describe('init', () => {
  it('sets the Angular version (if available) in the global scope', () => {
    const setContextSpy = jest.spyOn(SentryBrowser, 'setContext');

    init({});

    // In our case, the Angular version is 10 because that's the version we use for compilation
    // (and hence the dependency version of Angular core we installed (see package.json))
    expect(setContextSpy).toHaveBeenCalledTimes(1);
    expect(setContextSpy).toHaveBeenCalledWith('angular', { version: 10 });
  });

  describe('filtering out the `TryCatch` integration', () => {
    const browserInitSpy = jest.spyOn(SentryBrowser, 'init');

    beforeEach(() => {
      browserInitSpy.mockClear();
    });

    it('filters if `defaultIntegrations` is not set', () => {
      init({});

      expect(browserInitSpy).toHaveBeenCalledTimes(1);

      const options = browserInitSpy.mock.calls[0][0] || {};
      expect(options.defaultIntegrations).not.toContainEqual(expect.objectContaining({ name: 'TryCatch' }));
    });

    it.each([false as const, defaultIntegrations])(
      "doesn't filter if `defaultIntegrations` is set to %s",
      defaultIntegrations => {
        init({ defaultIntegrations });

        expect(browserInitSpy).toHaveBeenCalledTimes(1);

        const options = browserInitSpy.mock.calls[0][0] || {};
        expect(options.defaultIntegrations).toEqual(defaultIntegrations);
      },
    );
  });
});
