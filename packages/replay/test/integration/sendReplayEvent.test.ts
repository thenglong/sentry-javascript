import * as SentryCore from '@sentry/core';
import type { Transport } from '@sentry/types';
import * as SentryUtils from '@sentry/utils';

import { DEFAULT_FLUSH_MIN_DELAY, WINDOW } from '../../src/constants';
import type { ReplayContainer } from '../../src/replay';
import { clearSession } from '../../src/session/clearSession';
import { addEvent } from '../../src/util/addEvent';
import * as SendReplayRequest from '../../src/util/sendReplayRequest';
import { BASE_TIMESTAMP, mockRrweb, mockSdk } from '../index';
import { useFakeTimers } from '../utils/use-fake-timers';

useFakeTimers();

async function advanceTimers(time: number) {
  jest.advanceTimersByTime(time);
  await new Promise(process.nextTick);
}

type MockTransportSend = jest.MockedFunction<Transport['send']>;

describe('Integration | sendReplayEvent', () => {
  let replay: ReplayContainer;
  let mockTransportSend: MockTransportSend;
  let mockSendReplayRequest: jest.SpyInstance<any>;
  let domHandler: (args: any) => any;
  const { record: mockRecord } = mockRrweb();

  beforeAll(async () => {
    jest.setSystemTime(new Date(BASE_TIMESTAMP));
    jest.spyOn(SentryUtils, 'addInstrumentationHandler').mockImplementation((type, handler: (args: any) => any) => {
      if (type === 'dom') {
        domHandler = handler;
      }
    });

    ({ replay } = await mockSdk({
      replayOptions: {
        flushMinDelay: 5_000,
        flushMaxDelay: 15_000,
        stickySession: false,
        _experiments: {
          captureExceptions: true,
        },
      },
    }));

    mockSendReplayRequest = jest.spyOn(SendReplayRequest, 'sendReplayRequest');

    jest.runAllTimers();
    mockTransportSend = SentryCore.getCurrentHub()?.getClient()?.getTransport()?.send as MockTransportSend;
  });

  beforeEach(() => {
    jest.setSystemTime(new Date(BASE_TIMESTAMP));
    mockRecord.takeFullSnapshot.mockClear();
    mockTransportSend.mockClear();

    // Create a new session and clear mocks because a segment (from initial
    // checkout) will have already been uploaded by the time the tests run
    clearSession(replay);
    replay['_loadAndCheckSession']();

    mockSendReplayRequest.mockClear();
  });

  afterEach(async () => {
    jest.runAllTimers();
    await new Promise(process.nextTick);
    jest.setSystemTime(new Date(BASE_TIMESTAMP));
    clearSession(replay);
    replay['_loadAndCheckSession']();
  });

  afterAll(() => {
    replay && replay.stop();
  });

  it('uploads a replay event when document becomes hidden', async () => {
    mockRecord.takeFullSnapshot.mockClear();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: function () {
        return 'hidden';
      },
    });

    // Pretend 5 seconds have passed
    const ELAPSED = 5000;
    jest.advanceTimersByTime(ELAPSED);

    const TEST_EVENT = { data: {}, timestamp: BASE_TIMESTAMP, type: 2 };
    addEvent(replay, TEST_EVENT);

    document.dispatchEvent(new Event('visibilitychange'));

    await new Promise(process.nextTick);

    expect(mockRecord.takeFullSnapshot).not.toHaveBeenCalled();

    expect(replay).toHaveLastSentReplay({ recordingData: JSON.stringify([TEST_EVENT]) });

    // Session's last activity is not updated because we do not consider
    // visibilitystate as user being active
    expect(replay.session?.lastActivity).toBe(BASE_TIMESTAMP);
    expect(replay.session?.segmentId).toBe(1);

    // events array should be empty
    expect(replay.eventBuffer?.hasEvents).toBe(false);
  });

  it('update last activity when user clicks mouse', async () => {
    expect(replay.session?.lastActivity).toBe(BASE_TIMESTAMP);

    domHandler({
      name: 'click',
    });

    expect(replay.session?.lastActivity).toBe(BASE_TIMESTAMP);

    // Pretend 5 seconds have passed
    const ELAPSED = 5000;
    jest.advanceTimersByTime(ELAPSED);

    domHandler({
      name: 'click',
    });

    expect(replay.session?.lastActivity).toBe(BASE_TIMESTAMP + ELAPSED);
  });

  it('update last activity when user uses keyboard input', async () => {
    expect(replay.session?.lastActivity).toBe(BASE_TIMESTAMP);

    domHandler({
      name: 'input',
    });

    expect(replay.session?.lastActivity).toBe(BASE_TIMESTAMP);

    // Pretend 5 seconds have passed
    const ELAPSED = 5000;
    jest.advanceTimersByTime(ELAPSED);

    domHandler({
      name: 'input',
    });

    expect(replay.session?.lastActivity).toBe(BASE_TIMESTAMP + ELAPSED);
  });

  it('uploads a replay event if 5 seconds have elapsed since the last replay event occurred', async () => {
    const TEST_EVENT = { data: {}, timestamp: BASE_TIMESTAMP, type: 3 };
    mockRecord._emitter(TEST_EVENT);
    // Pretend 5 seconds have passed
    const ELAPSED = 5000;
    await advanceTimers(ELAPSED);

    expect(mockRecord.takeFullSnapshot).not.toHaveBeenCalled();

    expect(replay).toHaveLastSentReplay({ recordingData: JSON.stringify([TEST_EVENT]) });

    // No user activity to trigger an update
    expect(replay.session?.lastActivity).toBe(BASE_TIMESTAMP);
    expect(replay.session?.segmentId).toBe(1);

    // events array should be empty
    expect(replay.eventBuffer?.hasEvents).toBe(false);
  });

  it('uploads a replay event if maxFlushDelay is set 15 seconds have elapsed since the last replay upload', async () => {
    const TEST_EVENT = { data: {}, timestamp: BASE_TIMESTAMP, type: 3 };
    // Fire a new event every 4 seconds, 4 times
    for (let i = 0; i < 4; i++) {
      mockRecord._emitter(TEST_EVENT);
      jest.advanceTimersByTime(4_000);
    }

    // We are at time = +16seconds now (relative to BASE_TIMESTAMP)
    // The next event should cause an upload immediately
    mockRecord._emitter(TEST_EVENT);
    await new Promise(process.nextTick);

    expect(replay).toHaveLastSentReplay({
      recordingData: JSON.stringify([...Array(5)].map(() => TEST_EVENT)),
    });

    // There should also not be another attempt at an upload 5 seconds after the last replay event
    mockTransportSend.mockClear();
    await advanceTimers(DEFAULT_FLUSH_MIN_DELAY);
    expect(replay).not.toHaveLastSentReplay();

    expect(replay.session?.lastActivity).toBe(BASE_TIMESTAMP);
    expect(replay.session?.segmentId).toBe(1);
    // events array should be empty
    expect(replay.eventBuffer?.hasEvents).toBe(false);

    // Let's make sure it continues to work
    mockTransportSend.mockClear();
    mockRecord._emitter(TEST_EVENT);
    await advanceTimers(DEFAULT_FLUSH_MIN_DELAY);
    expect(replay).toHaveLastSentReplay({ recordingData: JSON.stringify([TEST_EVENT]) });
  });

  it('uploads a replay event when WINDOW is blurred', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: function () {
        return 'hidden';
      },
    });

    // Pretend 5 seconds have passed
    const ELAPSED = 5000;
    jest.advanceTimersByTime(ELAPSED);

    const TEST_EVENT = { data: {}, timestamp: BASE_TIMESTAMP, type: 2 };
    const hiddenBreadcrumb = {
      type: 5,
      timestamp: +new Date(BASE_TIMESTAMP + ELAPSED) / 1000,
      data: {
        tag: 'breadcrumb',
        payload: {
          timestamp: +new Date(BASE_TIMESTAMP + ELAPSED) / 1000,
          type: 'default',
          category: 'ui.blur',
        },
      },
    };

    addEvent(replay, TEST_EVENT);
    WINDOW.dispatchEvent(new Event('blur'));
    await new Promise(process.nextTick);
    expect(mockRecord.takeFullSnapshot).not.toHaveBeenCalled();
    expect(replay).toHaveLastSentReplay({
      recordingData: JSON.stringify([TEST_EVENT, hiddenBreadcrumb]),
    });
    // Session's last activity should not be updated
    expect(replay.session?.lastActivity).toBe(BASE_TIMESTAMP);
    // events array should be empty
    expect(replay.eventBuffer?.hasEvents).toBe(false);
  });

  it('uploads a replay event when document becomes hidden', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: function () {
        return 'hidden';
      },
    });
    // Pretend 5 seconds have passed
    const ELAPSED = 5000;
    jest.advanceTimersByTime(ELAPSED);

    const TEST_EVENT = { data: {}, timestamp: BASE_TIMESTAMP, type: 2 };

    addEvent(replay, TEST_EVENT);
    document.dispatchEvent(new Event('visibilitychange'));
    jest.runAllTimers();
    await new Promise(process.nextTick);

    expect(mockRecord.takeFullSnapshot).not.toHaveBeenCalled();
    expect(replay).toHaveLastSentReplay({ recordingData: JSON.stringify([TEST_EVENT]) });

    // Session's last activity is not updated because we do not consider
    // visibilitystate as user being active
    expect(replay.session?.lastActivity).toBe(BASE_TIMESTAMP);
    // events array should be empty
    expect(replay.eventBuffer?.hasEvents).toBe(false);
  });

  it('uploads a dom breadcrumb 5 seconds after listener receives an event', async () => {
    domHandler({
      name: 'click',
    });

    // Pretend 5 seconds have passed
    const ELAPSED = 5000;
    await advanceTimers(ELAPSED);

    expect(replay).toHaveLastSentReplay({
      recordingData: JSON.stringify([
        {
          type: 5,
          timestamp: BASE_TIMESTAMP,
          data: {
            tag: 'breadcrumb',
            payload: {
              timestamp: BASE_TIMESTAMP / 1000,
              type: 'default',
              category: 'ui.click',
              message: '<unknown>',
              data: {},
            },
          },
        },
      ]),
    });

    expect(replay.session?.segmentId).toBe(1);
  });

  it('fails to upload data on first two calls and succeeds on the third', async () => {
    expect(replay.session?.segmentId).toBe(0);
    const TEST_EVENT = { data: {}, timestamp: BASE_TIMESTAMP, type: 3 };

    // Suppress console.errors
    const mockConsole = jest.spyOn(console, 'error').mockImplementation(jest.fn());

    // fail the first and second requests and pass the third one
    mockTransportSend.mockImplementationOnce(() => {
      throw new Error('Something bad happened');
    });
    mockRecord._emitter(TEST_EVENT);
    await advanceTimers(DEFAULT_FLUSH_MIN_DELAY);

    expect(mockRecord.takeFullSnapshot).not.toHaveBeenCalled();
    mockTransportSend.mockImplementationOnce(() => {
      throw new Error('Something bad happened');
    });
    await advanceTimers(DEFAULT_FLUSH_MIN_DELAY);

    // next tick should retry and succeed
    mockConsole.mockRestore();

    await advanceTimers(8000);
    await advanceTimers(2000);

    expect(replay).toHaveLastSentReplay({
      replayEventPayload: expect.objectContaining({
        error_ids: [],
        replay_id: expect.any(String),
        replay_start_timestamp: BASE_TIMESTAMP / 1000,
        // timestamp is set on first try, after 5s flush
        timestamp: (BASE_TIMESTAMP + 5000) / 1000,
        trace_ids: [],
        urls: ['http://localhost/'],
      }),
      recordingPayloadHeader: { segment_id: 0 },
      recordingData: JSON.stringify([TEST_EVENT]),
    });

    mockTransportSend.mockClear();
    // No activity has occurred, session's last activity should remain the same
    expect(replay.session?.lastActivity).toBeGreaterThanOrEqual(BASE_TIMESTAMP);
    expect(replay.session?.segmentId).toBe(1);

    // next tick should do nothing
    await advanceTimers(DEFAULT_FLUSH_MIN_DELAY);
    expect(replay).not.toHaveLastSentReplay();
  });

  it('fails to upload data and hits retry max and stops', async () => {
    const TEST_EVENT = { data: {}, timestamp: BASE_TIMESTAMP, type: 3 };

    const spyHandleException = jest.spyOn(SentryCore, 'captureException');

    // Suppress console.errors
    const mockConsole = jest.spyOn(console, 'error').mockImplementation(jest.fn());

    expect(replay.session?.segmentId).toBe(0);

    // fail all requests
    mockSendReplayRequest.mockImplementation(async () => {
      throw new Error('Something bad happened');
    });
    mockRecord._emitter(TEST_EVENT);

    await advanceTimers(DEFAULT_FLUSH_MIN_DELAY);

    expect(mockRecord.takeFullSnapshot).not.toHaveBeenCalled();
    expect(mockSendReplayRequest).toHaveBeenCalledTimes(1);

    await advanceTimers(DEFAULT_FLUSH_MIN_DELAY);
    expect(mockSendReplayRequest).toHaveBeenCalledTimes(2);

    await advanceTimers(10000);
    expect(mockSendReplayRequest).toHaveBeenCalledTimes(3);

    await advanceTimers(30000);
    expect(mockSendReplayRequest).toHaveBeenCalledTimes(4);

    mockConsole.mockReset();

    // Make sure it doesn't retry again
    jest.runAllTimers();
    expect(mockSendReplayRequest).toHaveBeenCalledTimes(4);

    // Retries = 3 (total tries = 4 including initial attempt)
    // + last exception is max retries exceeded
    expect(spyHandleException).toHaveBeenCalledTimes(5);
    expect(spyHandleException).toHaveBeenLastCalledWith(new Error('Unable to send Replay - max retries exceeded'));

    const spyHandleExceptionCall = spyHandleException.mock.calls;
    expect(spyHandleExceptionCall[spyHandleExceptionCall.length - 1][0].cause.message).toEqual(
      'Something bad happened',
    );

    // Replay has stopped, no session should exist
    expect(replay.session).toBe(undefined);
    expect(replay.isEnabled()).toBe(false);

    // Events are ignored now, because we stopped
    mockRecord._emitter(TEST_EVENT);
    await advanceTimers(DEFAULT_FLUSH_MIN_DELAY);
    expect(mockSendReplayRequest).toHaveBeenCalledTimes(4);
  });

  // NOTE: If you add a test after the last one, make sure to adjust the test setup
  // As this ends with a `stopped()` replay, which may prevent future tests from working
  // Sadly, fixing this turned out to be much more annoying than expected, so leaving this warning here for now
});
