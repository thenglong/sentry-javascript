import type { Scope } from '@sentry/core';
import {
  addTracingExtensions,
  BaseClient,
  createCheckInEnvelope,
  getDynamicSamplingContextFromClient,
  SDK_VERSION,
  SessionFlusher,
} from '@sentry/core';
import type {
  CheckIn,
  DynamicSamplingContext,
  Event,
  EventHint,
  MonitorConfig,
  SerializedCheckIn,
  Severity,
  SeverityLevel,
  TraceContext,
} from '@sentry/types';
import { logger, resolvedSyncPromise, uuid4 } from '@sentry/utils';
import * as os from 'os';
import { TextEncoder } from 'util';

import { eventFromMessage, eventFromUnknownInput } from './eventbuilder';
import type { NodeClientOptions } from './types';

/**
 * The Sentry Node SDK Client.
 *
 * @see NodeClientOptions for documentation on configuration options.
 * @see SentryClient for usage documentation.
 */
export class NodeClient extends BaseClient<NodeClientOptions> {
  protected _sessionFlusher: SessionFlusher | undefined;

  /**
   * Creates a new Node SDK instance.
   * @param options Configuration options for this SDK.
   */
  public constructor(options: NodeClientOptions) {
    options._metadata = options._metadata || {};
    options._metadata.sdk = options._metadata.sdk || {
      name: 'sentry.javascript.node',
      packages: [
        {
          name: 'npm:@sentry/node',
          version: SDK_VERSION,
        },
      ],
      version: SDK_VERSION,
    };

    // Until node supports global TextEncoder in all versions we support, we are forced to pass it from util
    options.transportOptions = {
      textEncoder: new TextEncoder(),
      ...options.transportOptions,
    };

    // The Node client always supports tracing
    addTracingExtensions();

    super(options);
  }

  /**
   * @inheritDoc
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
  public captureException(exception: any, hint?: EventHint, scope?: Scope): string | undefined {
    // Check if the flag `autoSessionTracking` is enabled, and if `_sessionFlusher` exists because it is initialised only
    // when the `requestHandler` middleware is used, and hence the expectation is to have SessionAggregates payload
    // sent to the Server only when the `requestHandler` middleware is used
    if (this._options.autoSessionTracking && this._sessionFlusher && scope) {
      const requestSession = scope.getRequestSession();

      // Necessary checks to ensure this is code block is executed only within a request
      // Should override the status only if `requestSession.status` is `Ok`, which is its initial stage
      if (requestSession && requestSession.status === 'ok') {
        requestSession.status = 'errored';
      }
    }

    return super.captureException(exception, hint, scope);
  }

  /**
   * @inheritDoc
   */
  public captureEvent(event: Event, hint?: EventHint, scope?: Scope): string | undefined {
    // Check if the flag `autoSessionTracking` is enabled, and if `_sessionFlusher` exists because it is initialised only
    // when the `requestHandler` middleware is used, and hence the expectation is to have SessionAggregates payload
    // sent to the Server only when the `requestHandler` middleware is used
    if (this._options.autoSessionTracking && this._sessionFlusher && scope) {
      const eventType = event.type || 'exception';
      const isException =
        eventType === 'exception' && event.exception && event.exception.values && event.exception.values.length > 0;

      // If the event is of type Exception, then a request session should be captured
      if (isException) {
        const requestSession = scope.getRequestSession();

        // Ensure that this is happening within the bounds of a request, and make sure not to override
        // Session Status if Errored / Crashed
        if (requestSession && requestSession.status === 'ok') {
          requestSession.status = 'errored';
        }
      }
    }

    return super.captureEvent(event, hint, scope);
  }

  /**
   *
   * @inheritdoc
   */
  public close(timeout?: number): PromiseLike<boolean> {
    this._sessionFlusher?.close();
    return super.close(timeout);
  }

  /** Method that initialises an instance of SessionFlusher on Client */
  public initSessionFlusher(): void {
    const { release, environment } = this._options;
    if (!release) {
      __DEBUG_BUILD__ && logger.warn('Cannot initialise an instance of SessionFlusher if no release is provided!');
    } else {
      this._sessionFlusher = new SessionFlusher(this, {
        release,
        environment,
      });
    }
  }

  /**
   * @inheritDoc
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
  public eventFromException(exception: any, hint?: EventHint): PromiseLike<Event> {
    return resolvedSyncPromise(eventFromUnknownInput(this._options.stackParser, exception, hint));
  }

  /**
   * @inheritDoc
   */
  public eventFromMessage(
    message: string,
    // eslint-disable-next-line deprecation/deprecation
    level: Severity | SeverityLevel = 'info',
    hint?: EventHint,
  ): PromiseLike<Event> {
    return resolvedSyncPromise(
      eventFromMessage(this._options.stackParser, message, level, hint, this._options.attachStacktrace),
    );
  }

  /**
   * Create a cron monitor check in and send it to Sentry.
   *
   * @param checkIn An object that describes a check in.
   * @param upsertMonitorConfig An optional object that describes a monitor config. Use this if you want
   * to create a monitor automatically when sending a check in.
   * @returns A string representing the id of the check in.
   */
  public captureCheckIn(checkIn: CheckIn, monitorConfig?: MonitorConfig, scope?: Scope): string {
    const id = checkIn.status !== 'in_progress' && checkIn.checkInId ? checkIn.checkInId : uuid4();
    if (!this._isEnabled()) {
      __DEBUG_BUILD__ && logger.warn('SDK not enabled, will not capture checkin.');
      return id;
    }

    const options = this.getOptions();
    const { release, environment, tunnel } = options;

    const serializedCheckIn: SerializedCheckIn = {
      check_in_id: id,
      monitor_slug: checkIn.monitorSlug,
      status: checkIn.status,
      release,
      environment,
    };

    if (checkIn.status !== 'in_progress') {
      serializedCheckIn.duration = checkIn.duration;
    }

    if (monitorConfig) {
      serializedCheckIn.monitor_config = {
        schedule: monitorConfig.schedule,
        checkin_margin: monitorConfig.checkinMargin,
        max_runtime: monitorConfig.maxRuntime,
        timezone: monitorConfig.timezone,
      };
    }

    const [dynamicSamplingContext, traceContext] = this._getTraceInfoFromScope(scope);
    if (traceContext) {
      serializedCheckIn.contexts = {
        trace: traceContext,
      };
    }

    const envelope = createCheckInEnvelope(
      serializedCheckIn,
      dynamicSamplingContext,
      this.getSdkMetadata(),
      tunnel,
      this.getDsn(),
    );

    __DEBUG_BUILD__ && logger.info('Sending checkin:', checkIn.monitorSlug, checkIn.status);
    void this._sendEnvelope(envelope);
    return id;
  }

  /**
   * @inheritDoc
   */
  protected _prepareEvent(event: Event, hint: EventHint, scope?: Scope): PromiseLike<Event | null> {
    event.platform = event.platform || 'node';
    event.contexts = {
      ...event.contexts,
      runtime: event.contexts?.runtime || {
        name: 'node',
        version: global.process.version,
      },
    };
    event.server_name =
      event.server_name || this.getOptions().serverName || global.process.env.SENTRY_NAME || os.hostname();
    return super._prepareEvent(event, hint, scope);
  }

  /**
   * Method responsible for capturing/ending a request session by calling `incrementSessionStatusCount` to increment
   * appropriate session aggregates bucket
   */
  protected _captureRequestSession(): void {
    if (!this._sessionFlusher) {
      __DEBUG_BUILD__ && logger.warn('Discarded request mode session because autoSessionTracking option was disabled');
    } else {
      this._sessionFlusher.incrementSessionStatusCount();
    }
  }

  /** Extract trace information from scope */
  private _getTraceInfoFromScope(
    scope: Scope | undefined,
  ): [dynamicSamplingContext: Partial<DynamicSamplingContext> | undefined, traceContext: TraceContext | undefined] {
    if (!scope) {
      return [undefined, undefined];
    }

    const span = scope.getSpan();
    if (span) {
      return [span?.transaction?.getDynamicSamplingContext(), span?.getTraceContext()];
    }

    const { traceId, spanId, parentSpanId, dsc } = scope.getPropagationContext();
    const traceContext: TraceContext = {
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parentSpanId,
    };
    if (dsc) {
      return [dsc, traceContext];
    }

    return [getDynamicSamplingContextFromClient(traceId, this, scope), traceContext];
  }
}
