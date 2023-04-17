import { expect } from '@playwright/test';

import { sentryTest } from '../../../../../utils/fixtures';
import { envelopeRequestParser, waitForErrorRequest } from '../../../../../utils/helpers';
import {
  getCustomRecordingEvents,
  shouldSkipReplayTest,
  waitForReplayRequest,
} from '../../../../../utils/replayHelpers';

sentryTest(
  'captures text responseBody when experiment is configured',
  async ({ getLocalTestPath, page, browserName }) => {
    if (shouldSkipReplayTest()) {
      sentryTest.skip();
    }

    const additionalHeaders = browserName === 'webkit' ? { 'content-type': 'text/plain' } : undefined;

    await page.route('**/foo', route => {
      return route.fulfill({
        status: 200,
        body: 'response body',
      });
    });

    await page.route('https://dsn.ingest.sentry.io/**/*', route => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'test-id' }),
      });
    });

    const requestPromise = waitForErrorRequest(page);
    const replayRequestPromise1 = waitForReplayRequest(page, 0);

    const url = await getLocalTestPath({ testDir: __dirname });
    await page.goto(url);

    await page.evaluate(() => {
      /* eslint-disable */
      fetch('http://localhost:7654/foo', {
        method: 'POST',
      }).then(() => {
        // @ts-ignore Sentry is a global
        Sentry.captureException('test error');
      });
      /* eslint-enable */
    });

    const request = await requestPromise;
    const eventData = envelopeRequestParser(request);

    expect(eventData.exception?.values).toHaveLength(1);

    expect(eventData?.breadcrumbs?.length).toBe(1);
    expect(eventData!.breadcrumbs![0]).toEqual({
      timestamp: expect.any(Number),
      category: 'fetch',
      type: 'http',
      data: {
        method: 'POST',
        response_body_size: 13,
        status_code: 200,
        url: 'http://localhost:7654/foo',
      },
    });

    const replayReq1 = await replayRequestPromise1;
    const { performanceSpans: performanceSpans1 } = getCustomRecordingEvents(replayReq1);
    expect(performanceSpans1.filter(span => span.op === 'resource.fetch')).toEqual([
      {
        data: {
          method: 'POST',
          statusCode: 200,
          response: {
            size: 13,
            headers: {
              'content-length': '13',
              ...additionalHeaders,
            },
            body: 'response body',
          },
        },
        description: 'http://localhost:7654/foo',
        endTimestamp: expect.any(Number),
        op: 'resource.fetch',
        startTimestamp: expect.any(Number),
      },
    ]);
  },
);

sentryTest(
  'captures JSON responseBody when experiment is configured',
  async ({ getLocalTestPath, page, browserName }) => {
    if (shouldSkipReplayTest()) {
      sentryTest.skip();
    }

    const additionalHeaders = browserName === 'webkit' ? { 'content-type': 'text/plain' } : undefined;

    await page.route('**/foo', route => {
      return route.fulfill({
        status: 200,
        body: JSON.stringify({ res: 'this' }),
      });
    });

    await page.route('https://dsn.ingest.sentry.io/**/*', route => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'test-id' }),
      });
    });

    const requestPromise = waitForErrorRequest(page);
    const replayRequestPromise1 = waitForReplayRequest(page, 0);

    const url = await getLocalTestPath({ testDir: __dirname });
    await page.goto(url);

    await page.evaluate(() => {
      /* eslint-disable */
      fetch('http://localhost:7654/foo', {
        method: 'POST',
      }).then(() => {
        // @ts-ignore Sentry is a global
        Sentry.captureException('test error');
      });
      /* eslint-enable */
    });

    const request = await requestPromise;
    const eventData = envelopeRequestParser(request);

    expect(eventData.exception?.values).toHaveLength(1);

    expect(eventData?.breadcrumbs?.length).toBe(1);
    expect(eventData!.breadcrumbs![0]).toEqual({
      timestamp: expect.any(Number),
      category: 'fetch',
      type: 'http',
      data: {
        method: 'POST',
        response_body_size: 14,
        status_code: 200,
        url: 'http://localhost:7654/foo',
      },
    });

    const replayReq1 = await replayRequestPromise1;
    const { performanceSpans: performanceSpans1 } = getCustomRecordingEvents(replayReq1);
    expect(performanceSpans1.filter(span => span.op === 'resource.fetch')).toEqual([
      {
        data: {
          method: 'POST',
          statusCode: 200,
          response: {
            size: 14,
            headers: {
              'content-length': '14',
              ...additionalHeaders,
            },
            body: { res: 'this' },
          },
        },
        description: 'http://localhost:7654/foo',
        endTimestamp: expect.any(Number),
        op: 'resource.fetch',
        startTimestamp: expect.any(Number),
      },
    ]);
  },
);

sentryTest(
  'captures non-text responseBody when experiment is configured',
  async ({ getLocalTestPath, page, browserName }) => {
    if (shouldSkipReplayTest()) {
      sentryTest.skip();
    }

    const additionalHeaders = browserName === 'webkit' ? { 'content-type': 'application/octet-stream' } : {};

    await page.route('**/foo', route => {
      return route.fulfill({
        status: 200,
        body: Buffer.from('<html>Hello world</html>'),
      });
    });

    await page.route('https://dsn.ingest.sentry.io/**/*', route => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'test-id' }),
      });
    });

    const requestPromise = waitForErrorRequest(page);
    const replayRequestPromise1 = waitForReplayRequest(page, 0);

    const url = await getLocalTestPath({ testDir: __dirname });
    await page.goto(url);

    await page.evaluate(() => {
      /* eslint-disable */
      fetch('http://localhost:7654/foo', {
        method: 'POST',
      }).then(() => {
        // @ts-ignore Sentry is a global
        Sentry.captureException('test error');
      });
      /* eslint-enable */
    });

    const request = await requestPromise;
    const eventData = envelopeRequestParser(request);

    expect(eventData.exception?.values).toHaveLength(1);

    expect(eventData?.breadcrumbs?.length).toBe(1);
    expect(eventData!.breadcrumbs![0]).toEqual({
      timestamp: expect.any(Number),
      category: 'fetch',
      type: 'http',
      data: {
        method: 'POST',
        response_body_size: 24,
        status_code: 200,
        url: 'http://localhost:7654/foo',
      },
    });

    const replayReq1 = await replayRequestPromise1;
    const { performanceSpans: performanceSpans1 } = getCustomRecordingEvents(replayReq1);
    expect(performanceSpans1.filter(span => span.op === 'resource.fetch')).toEqual([
      {
        data: {
          method: 'POST',
          statusCode: 200,
          response: {
            size: 24,
            headers: {
              'content-length': '24',
              ...additionalHeaders,
            },
            body: '<html>Hello world</html>',
          },
        },
        description: 'http://localhost:7654/foo',
        endTimestamp: expect.any(Number),
        op: 'resource.fetch',
        startTimestamp: expect.any(Number),
      },
    ]);
  },
);
