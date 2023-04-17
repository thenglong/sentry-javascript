import { expect } from '@playwright/test';

import { sentryTest } from '../../../../utils/fixtures';
import { envelopeRequestParser, shouldSkipTracingTest, waitForTransactionRequest } from '../../../../utils/helpers';

sentryTest('should handle custom added BrowserTracing integration', async ({ getLocalTestUrl, page }) => {
  if (shouldSkipTracingTest()) {
    sentryTest.skip();
  }

  const req = waitForTransactionRequest(page);

  const url = await getLocalTestUrl({ testDir: __dirname });
  await page.goto(url);

  const eventData = envelopeRequestParser(await req);
  const timeOrigin = await page.evaluate<number>('window._testBaseTimestamp');

  const { start_timestamp: startTimestamp } = eventData;

  expect(startTimestamp).toBeCloseTo(timeOrigin, 1);

  expect(eventData.contexts?.trace?.op).toBe('pageload');
  expect(eventData.spans?.length).toBeGreaterThan(0);
  expect(eventData.transaction_info?.source).toEqual('url');

  const tracePropagationTargets = await page.evaluate(() => {
    const browserTracing = (window as any).Sentry.getCurrentHub().getClient().getIntegrationById('BrowserTracing');
    return browserTracing.options.tracePropagationTargets;
  });

  expect(tracePropagationTargets).toEqual(['http://localhost:1234']);
});
