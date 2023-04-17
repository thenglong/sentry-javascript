import { expect } from '@playwright/test';

import { sentryTest } from '../../../../utils/fixtures';
import { envelopeRequestParser, waitForErrorRequest } from '../../../../utils/helpers';

sentryTest('error handler works with a recursive custom error handler', async ({ getLocalTestUrl, page }) => {
  const req = waitForErrorRequest(page);

  const url = await getLocalTestUrl({ testDir: __dirname });
  await page.goto(url);

  const eventData = envelopeRequestParser(await req);
  expect(eventData.exception?.values?.length).toBe(1);
  expect(eventData.exception?.values?.[0]?.value).toBe('window.doSomethingWrong is not a function');
});
