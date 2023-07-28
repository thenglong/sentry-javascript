import { NextTestEnv } from './utils/helpers';
import nock from 'nock';

describe('Tracing HTTP', () => {
  it('should capture a transaction', async () => {
    const env = await NextTestEnv.init();
    const url = `${env.url}/api/http`;

    // this intercepts the outgoing request made by the route handler (which it makes in order to test span creation)
    nock('http://example.com').get('/').reply(200, 'ok');

    const envelope = await env.getEnvelopeRequest({
      url,
      envelopeType: 'transaction',
    });

    expect(envelope[2]).toMatchObject({
      contexts: {
        trace: {
          op: 'http.server',
          status: 'ok',
          tags: { 'http.status_code': '200' },
          data: {
            'http.response.status_code': 200,
          },
        },
      },
      spans: [
        {
          description: 'GET http://example.com/',
          op: 'http.client',
          status: 'ok',
          tags: { 'http.status_code': '200' },
          data: {
            'http.response.status_code': 200,
          },
        },
      ],
      transaction: 'GET /api/http',
      transaction_info: {
        source: 'route',
      },
      type: 'transaction',
      request: {
        url,
      },
    });
  });
});
