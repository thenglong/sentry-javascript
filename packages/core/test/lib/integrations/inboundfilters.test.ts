import type { Event, EventProcessor } from '@sentry/types';

import type { InboundFiltersOptions } from '../../../src/integrations/inboundfilters';
import { InboundFilters } from '../../../src/integrations/inboundfilters';

/**
 * Creates an instance of the InboundFilters integration and returns
 * the event processor that the InboundFilters integration creates.
 *
 * To test the InboundFilters integration, call this function and assert on
 * how the event processor handles an event. For example, if you set up the
 * InboundFilters to filter out an SOME_EXCEPTION_EVENT.
 *
 * ```
 * // some options that cause SOME_EXCEPTION_EVENT to be filtered
 * const eventProcessor = createInboundFiltersEventProcessor(options);
 *
 * expect(eventProcessor(SOME_EXCEPTION_EVENT)).toBe(null);
 * ```
 *
 * @param options options passed into the InboundFilters integration
 * @param clientOptions options passed into the mock Sentry client
 */
function createInboundFiltersEventProcessor(
  options: Partial<InboundFiltersOptions> = {},
  clientOptions: Partial<InboundFiltersOptions> = {},
): EventProcessor {
  const eventProcessors: EventProcessor[] = [];
  const inboundFiltersInstance = new InboundFilters(options);

  function addGlobalEventProcessor(processor: EventProcessor): void {
    eventProcessors.push(processor);
    expect(eventProcessors).toHaveLength(1);
  }

  function getCurrentHub(): any {
    return {
      getIntegration(_integration: any): any {
        // pretend integration is enabled
        return inboundFiltersInstance;
      },
      getClient(): any {
        return {
          getOptions: () => clientOptions,
        };
      },
    };
  }

  inboundFiltersInstance.setupOnce(addGlobalEventProcessor, getCurrentHub);
  return eventProcessors[0];
}

// Fixtures

const MESSAGE_EVENT: Event = {
  message: 'captureMessage',
};

const MESSAGE_EVENT_2: Event = {
  message: 'captureMessageSomething',
};

const MESSAGE_EVENT_WITH_STACKTRACE: Event = {
  message: 'wat',
  exception: {
    values: [
      {
        stacktrace: {
          // Frames are always in the reverse order, as this is how Sentry expect them to come.
          // Frame that crashed is the last one, the one from awesome-analytics
          frames: [
            { filename: 'https://our-side.com/js/bundle.js' },
            { filename: 'https://our-side.com/js/bundle.js' },
            { filename: 'https://awesome-analytics.io/some/file.js' },
          ],
        },
      },
    ],
  },
};

const MESSAGE_EVENT_WITH_ANON_LAST_FRAME: Event = {
  message: 'any',
  exception: {
    values: [
      {
        stacktrace: {
          frames: [
            { filename: 'https://our-side.com/js/bundle.js' },
            { filename: 'https://awesome-analytics.io/some/file.js' },
            { filename: '<anonymous>' },
          ],
        },
      },
    ],
  },
};

const MESSAGE_EVENT_WITH_NATIVE_LAST_FRAME: Event = {
  message: 'any',
  exception: {
    values: [
      {
        stacktrace: {
          frames: [
            { filename: 'https://our-side.com/js/bundle.js' },
            { filename: 'https://awesome-analytics.io/some/file.js' },
            { filename: '[native code]' },
          ],
        },
      },
    ],
  },
};

const EXCEPTION_EVENT: Event = {
  exception: {
    values: [
      {
        type: 'SyntaxError',
        value: 'unidentified ? at line 1337',
      },
    ],
  },
};

const EXCEPTION_EVENT_WITH_FRAMES: Event = {
  exception: {
    values: [
      {
        stacktrace: {
          // Frames are always in the reverse order, as this is how Sentry expect them to come.
          // Frame that crashed is the last one, the one from awesome-analytics
          frames: [
            { filename: 'https://our-side.com/js/bundle.js' },
            { filename: 'https://our-side.com/js/bundle.js' },
            { filename: 'https://awesome-analytics.io/some/file.js' },
          ],
        },
      },
    ],
  },
};

const EXCEPTION_EVENT_WITH_LINKED_ERRORS: Event = {
  exception: {
    values: [
      {
        type: 'ReferenceError',
        value: '`tooManyTreats` is not defined',
      },
      {
        type: 'TypeError',
        value: 'incorrect type given for parameter `chewToy`: Shoe',
      },
    ],
  },
};

const SENTRY_EVENT: Event = {
  exception: {
    values: [
      {
        type: 'SentryError',
        value: 'something something server connection',
      },
    ],
  },
};

const SCRIPT_ERROR_EVENT: Event = {
  exception: {
    values: [
      {
        type: '[undefined]',
        value: 'Script error.',
      },
    ],
  },
};

const MALFORMED_EVENT: Event = {
  exception: {
    values: [
      {
        stacktrace: {
          frames: undefined,
        },
      },
    ],
  },
};

const TRANSACTION_EVENT: Event = {
  message: 'transaction message',
  transaction: 'transaction name',
  type: 'transaction',
};

const TRANSACTION_EVENT_2: Event = {
  transaction: 'transaction name 2',
  type: 'transaction',
};

const TRANSACTION_EVENT_3: Event = {
  transaction: 'other name',
  type: 'transaction',
};

const TRANSACTION_EVENT_HEALTH: Event = {
  transaction: 'GET /health',
  type: 'transaction',
};

const TRANSACTION_EVENT_HEALTH_2: Event = {
  transaction: 'GET /healthy',
  type: 'transaction',
};

const TRANSACTION_EVENT_HEALTH_3: Event = {
  transaction: 'GET /live',
  type: 'transaction',
};

describe('InboundFilters', () => {
  describe('_isSentryError', () => {
    it('should work as expected', () => {
      const eventProcessor = createInboundFiltersEventProcessor();
      expect(eventProcessor(MESSAGE_EVENT, {})).toBe(MESSAGE_EVENT);
      expect(eventProcessor(EXCEPTION_EVENT, {})).toBe(EXCEPTION_EVENT);
      expect(eventProcessor(SENTRY_EVENT, {})).toBe(null);
    });

    it('should be configurable', () => {
      const eventProcessor = createInboundFiltersEventProcessor({ ignoreInternal: false });
      expect(eventProcessor(MESSAGE_EVENT, {})).toBe(MESSAGE_EVENT);
      expect(eventProcessor(EXCEPTION_EVENT, {})).toBe(EXCEPTION_EVENT);
      expect(eventProcessor(SENTRY_EVENT, {})).toBe(SENTRY_EVENT);
    });
  });

  describe('ignoreErrors', () => {
    it('string filter with partial match', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreErrors: ['capture'],
      });
      expect(eventProcessor(MESSAGE_EVENT, {})).toBe(null);
    });

    it('ignores transaction event for filtering', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreErrors: ['transaction'],
      });
      expect(eventProcessor(TRANSACTION_EVENT, {})).toBe(TRANSACTION_EVENT);
    });

    it('string filter with exact match', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreErrors: ['captureMessage'],
      });
      expect(eventProcessor(MESSAGE_EVENT, {})).toBe(null);
    });

    it('regexp filter with partial match', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreErrors: [/capture/],
      });
      expect(eventProcessor(MESSAGE_EVENT, {})).toBe(null);
    });

    it('regexp filter with exact match', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreErrors: [/^captureMessage$/],
      });
      expect(eventProcessor(MESSAGE_EVENT, {})).toBe(null);
      expect(eventProcessor(MESSAGE_EVENT_2, {})).toBe(MESSAGE_EVENT_2);
    });

    it('prefers message when both message and exception are available', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreErrors: [/captureMessage/],
      });
      const event = {
        ...EXCEPTION_EVENT,
        ...MESSAGE_EVENT,
      };
      expect(eventProcessor(event, {})).toBe(null);
    });

    it('can use multiple filters', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreErrors: ['captureMessage', /SyntaxError/],
      });
      expect(eventProcessor(MESSAGE_EVENT, {})).toBe(null);
      expect(eventProcessor(EXCEPTION_EVENT, {})).toBe(null);
    });

    it('uses default filters', () => {
      const eventProcessor = createInboundFiltersEventProcessor();
      expect(eventProcessor(SCRIPT_ERROR_EVENT, {})).toBe(null);
    });

    it('filters on last exception when multiple present', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreErrors: ['incorrect type given for parameter `chewToy`'],
      });
      expect(eventProcessor(EXCEPTION_EVENT_WITH_LINKED_ERRORS, {})).toBe(null);
    });

    it("doesn't filter on `cause` exception when multiple present", () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreErrors: ['`tooManyTreats` is not defined'],
      });
      expect(eventProcessor(EXCEPTION_EVENT_WITH_LINKED_ERRORS, {})).toBe(EXCEPTION_EVENT_WITH_LINKED_ERRORS);
    });

    describe('on exception', () => {
      it('uses exception data when message is unavailable', () => {
        const eventProcessor = createInboundFiltersEventProcessor({
          ignoreErrors: ['SyntaxError: unidentified ? at line 1337'],
        });
        expect(eventProcessor(EXCEPTION_EVENT, {})).toBe(null);
      });

      it('can match on exception value', () => {
        const eventProcessor = createInboundFiltersEventProcessor({
          ignoreErrors: [/unidentified \?/],
        });
        expect(eventProcessor(EXCEPTION_EVENT, {})).toBe(null);
      });

      it('can match on exception type', () => {
        const eventProcessor = createInboundFiltersEventProcessor({
          ignoreErrors: [/^SyntaxError/],
        });
        expect(eventProcessor(EXCEPTION_EVENT, {})).toBe(null);
      });
    });
  });

  describe('ignoreTransactions', () => {
    it('string filter with partial match', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreTransactions: ['name'],
      });
      expect(eventProcessor(TRANSACTION_EVENT, {})).toBe(null);
    });

    it('ignores error event for filtering', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreTransactions: ['capture'],
      });
      expect(eventProcessor(MESSAGE_EVENT, {})).toBe(MESSAGE_EVENT);
    });

    it('string filter with exact match', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreTransactions: ['transaction name'],
      });
      expect(eventProcessor(TRANSACTION_EVENT, {})).toBe(null);
    });

    it('regexp filter with partial match', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreTransactions: [/name/],
      });
      expect(eventProcessor(TRANSACTION_EVENT, {})).toBe(null);
    });

    it('regexp filter with exact match', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreTransactions: [/^transaction name$/],
      });
      expect(eventProcessor(TRANSACTION_EVENT, {})).toBe(null);
      expect(eventProcessor(TRANSACTION_EVENT_2, {})).toBe(TRANSACTION_EVENT_2);
    });

    it('can use multiple filters', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        ignoreTransactions: ['transaction name 2', /transaction/],
      });
      expect(eventProcessor(TRANSACTION_EVENT, {})).toBe(null);
      expect(eventProcessor(TRANSACTION_EVENT_2, {})).toBe(null);
      expect(eventProcessor(TRANSACTION_EVENT_3, {})).toBe(TRANSACTION_EVENT_3);
    });

    it('uses default filters', () => {
      const eventProcessor = createInboundFiltersEventProcessor();
      expect(eventProcessor(SCRIPT_ERROR_EVENT, {})).toBe(null);
      expect(eventProcessor(TRANSACTION_EVENT, {})).toBe(TRANSACTION_EVENT);
      expect(eventProcessor(TRANSACTION_EVENT_HEALTH, {})).toBe(null);
      expect(eventProcessor(TRANSACTION_EVENT_HEALTH_2, {})).toBe(null);
      expect(eventProcessor(TRANSACTION_EVENT_HEALTH_3, {})).toBe(null);
    });

    it('disable default error filters', () => {
      const eventProcessor = createInboundFiltersEventProcessor({ disableErrorDefaults: true });
      expect(eventProcessor(SCRIPT_ERROR_EVENT, {})).toBe(SCRIPT_ERROR_EVENT);
      expect(eventProcessor(TRANSACTION_EVENT_HEALTH, {})).toBe(null);
      expect(eventProcessor(TRANSACTION_EVENT_HEALTH_2, {})).toBe(null);
      expect(eventProcessor(TRANSACTION_EVENT_HEALTH_3, {})).toBe(null);
    });

    it('disable default transaction filters', () => {
      const eventProcessor = createInboundFiltersEventProcessor({ disableTransactionDefaults: true });
      expect(eventProcessor(SCRIPT_ERROR_EVENT, {})).toBe(null);
      expect(eventProcessor(TRANSACTION_EVENT, {})).toBe(TRANSACTION_EVENT);
      expect(eventProcessor(TRANSACTION_EVENT_HEALTH, {})).toBe(TRANSACTION_EVENT_HEALTH);
      expect(eventProcessor(TRANSACTION_EVENT_HEALTH_2, {})).toBe(TRANSACTION_EVENT_HEALTH_2);
      expect(eventProcessor(TRANSACTION_EVENT_HEALTH_3, {})).toBe(TRANSACTION_EVENT_HEALTH_3);
    });
  });

  describe('denyUrls/allowUrls', () => {
    it('should filter captured message based on its stack trace using string filter', () => {
      const eventProcessorDeny = createInboundFiltersEventProcessor({
        denyUrls: ['https://awesome-analytics.io'],
      });
      expect(eventProcessorDeny(MESSAGE_EVENT_WITH_STACKTRACE, {})).toBe(null);
    });

    it('should allow denyUrls to take precedence', () => {
      const eventProcessorBoth = createInboundFiltersEventProcessor({
        allowUrls: ['https://awesome-analytics.io'],
        denyUrls: ['https://awesome-analytics.io'],
      });
      expect(eventProcessorBoth(MESSAGE_EVENT_WITH_STACKTRACE, {})).toBe(null);
    });

    it('should filter captured message based on its stack trace using regexp filter', () => {
      const eventProcessorDeny = createInboundFiltersEventProcessor({
        denyUrls: [/awesome-analytics\.io/],
      });
      expect(eventProcessorDeny(MESSAGE_EVENT_WITH_STACKTRACE, {})).toBe(null);
    });

    it('should not filter captured messages with no stacktraces', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        denyUrls: ['https://awesome-analytics.io'],
      });
      expect(eventProcessor(MESSAGE_EVENT, {})).toBe(MESSAGE_EVENT);
    });

    it('should filter captured exception based on its stack trace using string filter', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        denyUrls: ['https://awesome-analytics.io'],
      });
      expect(eventProcessor(EXCEPTION_EVENT_WITH_FRAMES, {})).toBe(null);
    });

    it('should filter captured exception based on its stack trace using regexp filter', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        denyUrls: [/awesome-analytics\.io/],
      });
      expect(eventProcessor(EXCEPTION_EVENT_WITH_FRAMES, {})).toBe(null);
    });

    it("should not filter events that don't match the filtered values", () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        denyUrls: ['some-other-domain.com'],
      });
      expect(eventProcessor(EXCEPTION_EVENT_WITH_FRAMES, {})).toBe(EXCEPTION_EVENT_WITH_FRAMES);
    });

    it('should be able to use multiple filters', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        denyUrls: ['some-other-domain.com', /awesome-analytics\.io/],
      });
      expect(eventProcessor(EXCEPTION_EVENT_WITH_FRAMES, {})).toBe(null);
    });

    it('should not fail with malformed event event', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        denyUrls: ['https://awesome-analytics.io'],
      });
      expect(eventProcessor(MALFORMED_EVENT, {})).toBe(MALFORMED_EVENT);
    });

    it('should search for script names when there is an anonymous callback at the last frame', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        denyUrls: ['https://awesome-analytics.io/some/file.js'],
      });
      expect(eventProcessor(MESSAGE_EVENT_WITH_ANON_LAST_FRAME, {})).toBe(null);
    });

    it('should search for script names when the last frame is from native code', () => {
      const eventProcessor = createInboundFiltersEventProcessor({
        denyUrls: ['https://awesome-analytics.io/some/file.js'],
      });
      expect(eventProcessor(MESSAGE_EVENT_WITH_NATIVE_LAST_FRAME, {})).toBe(null);
    });
  });
});
