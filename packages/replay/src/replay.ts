/* eslint-disable max-lines */ // TODO: We might want to split this file up
import { EventType, record } from '@sentry-internal/rrweb';
import { captureException, getCurrentHub } from '@sentry/core';
import type { Breadcrumb, ReplayRecordingMode } from '@sentry/types';
import { logger } from '@sentry/utils';

import { ERROR_CHECKOUT_TIME, MAX_SESSION_LIFE, SESSION_IDLE_DURATION, WINDOW } from './constants';
import { setupPerformanceObserver } from './coreHandlers/performanceObserver';
import { createEventBuffer } from './eventBuffer';
import { getSession } from './session/getSession';
import { saveSession } from './session/saveSession';
import type {
  AddEventResult,
  AddUpdateCallback,
  AllPerformanceEntry,
  EventBuffer,
  InternalEventContext,
  PopEventContext,
  RecordingOptions,
  ReplayContainer as ReplayContainerInterface,
  ReplayExperimentalPluginOptions,
  ReplayPluginOptions,
  Session,
  Timeouts,
} from './types';
import { addEvent } from './util/addEvent';
import { addGlobalListeners } from './util/addGlobalListeners';
import { addMemoryEntry } from './util/addMemoryEntry';
import { createBreadcrumb } from './util/createBreadcrumb';
import { createPerformanceEntries } from './util/createPerformanceEntries';
import { createPerformanceSpans } from './util/createPerformanceSpans';
import { debounce } from './util/debounce';
import { getHandleRecordingEmit } from './util/handleRecordingEmit';
import { isExpired } from './util/isExpired';
import { isSessionExpired } from './util/isSessionExpired';
import { sendReplay } from './util/sendReplay';

/**
 * The main replay container class, which holds all the state and methods for recording and sending replays.
 */
export class ReplayContainer implements ReplayContainerInterface {
  public eventBuffer: EventBuffer | null = null;

  /**
   * List of PerformanceEntry from PerformanceObserver
   */
  public performanceEvents: AllPerformanceEntry[] = [];

  public session: Session | undefined;

  /**
   * Recording can happen in one of two modes:
   * * session: Record the whole session, sending it continuously
   * * error: Always keep the last 60s of recording, and when an error occurs, send it immediately
   */
  public recordingMode: ReplayRecordingMode = 'session';

  /**
   * These are here so we can overwrite them in tests etc.
   * @hidden
   */
  public readonly timeouts: Timeouts = {
    sessionIdle: SESSION_IDLE_DURATION,
    maxSessionLife: MAX_SESSION_LIFE,
  } as const;

  private readonly _experimentalOptions: ReplayExperimentalPluginOptions;

  /**
   * Options to pass to `rrweb.record()`
   */
  private readonly _recordingOptions: RecordingOptions;

  private readonly _options: ReplayPluginOptions;

  private _performanceObserver: PerformanceObserver | null = null;

  private _debouncedFlush: ReturnType<typeof debounce>;
  private _flushLock: Promise<unknown> | null = null;

  /**
   * Timestamp of the last user activity. This lives across sessions.
   */
  private _lastActivity: number = Date.now();

  /**
   * Is the integration currently active?
   */
  private _isEnabled: boolean = false;

  /**
   * Paused is a state where:
   * - DOM Recording is not listening at all
   * - Nothing will be added to event buffer (e.g. core SDK events)
   */
  private _isPaused: boolean = false;

  /**
   * Have we attached listeners to the core SDK?
   * Note we have to track this as there is no way to remove instrumentation handlers.
   */
  private _hasInitializedCoreListeners: boolean = false;

  /**
   * Function to stop recording
   */
  private _stopRecording: ReturnType<typeof record> | null = null;

  private _context: InternalEventContext = {
    errorIds: new Set(),
    traceIds: new Set(),
    urls: [],
    earliestEvent: null,
    initialTimestamp: Date.now(),
    initialUrl: '',
  };

  public constructor({
    options,
    recordingOptions,
  }: {
    options: ReplayPluginOptions;
    recordingOptions: RecordingOptions;
  }) {
    this._recordingOptions = recordingOptions;
    this._options = options;

    this._debouncedFlush = debounce(() => this._flush(), this._options.flushMinDelay, {
      maxWait: this._options.flushMaxDelay,
    });

    this._experimentalOptions = _getExperimentalOptions(options);
  }

  /** Get the event context. */
  public getContext(): InternalEventContext {
    return this._context;
  }

  /** If recording is currently enabled. */
  public isEnabled(): boolean {
    return this._isEnabled;
  }

  /** If recording is currently paused. */
  public isPaused(): boolean {
    return this._isPaused;
  }

  /** Get the replay integration options. */
  public getOptions(): ReplayPluginOptions {
    return this._options;
  }

  /**
   * Get the experimental options.
   * THIS IS INTERNAL AND SUBJECT TO CHANGE!
   * @hidden
   */
  public getExperimentalOptions(): ReplayExperimentalPluginOptions {
    return this._experimentalOptions;
  }

  /**
   * Initializes the plugin.
   *
   * Creates or loads a session, attaches listeners to varying events (DOM,
   * _performanceObserver, Recording, Sentry SDK, etc)
   */
  public start(): void {
    this.setInitialState();

    if (!this._loadAndCheckSession()) {
      return;
    }

    // If there is no session, then something bad has happened - can't continue
    if (!this.session) {
      this._handleException(new Error('No session found'));
      return;
    }

    if (!this.session.sampled) {
      // If session was not sampled, then we do not initialize the integration at all.
      return;
    }

    // If session is sampled for errors, then we need to set the recordingMode
    // to 'error', which will configure recording with different options.
    if (this.session.sampled === 'error') {
      this.recordingMode = 'error';
    }

    // setup() is generally called on page load or manually - in both cases we
    // should treat it as an activity
    this._updateSessionActivity();

    this.eventBuffer = createEventBuffer({
      useCompression: this._options.useCompression,
    });

    this._addListeners();

    // Need to set as enabled before we start recording, as `record()` can trigger a flush with a new checkout
    this._isEnabled = true;

    this.startRecording();
  }

  /**
   * Start recording.
   *
   * Note that this will cause a new DOM checkout
   */
  public startRecording(): void {
    try {
      this._stopRecording = record({
        ...this._recordingOptions,
        // When running in error sampling mode, we need to overwrite `checkoutEveryNms`
        // Without this, it would record forever, until an error happens, which we don't want
        // instead, we'll always keep the last 60 seconds of replay before an error happened
        ...(this.recordingMode === 'error' && { checkoutEveryNms: ERROR_CHECKOUT_TIME }),
        emit: getHandleRecordingEmit(this),
        onMutation: this._onMutationHandler,
      });
    } catch (err) {
      this._handleException(err);
    }
  }

  /**
   * Stops the recording, if it was running.
   * Returns true if it was stopped, else false.
   */
  public stopRecording(): boolean {
    try {
      if (this._stopRecording) {
        this._stopRecording();
        this._stopRecording = undefined;
        return true;
      }

      return false;
    } catch (err) {
      this._handleException(err);
      return false;
    }
  }

  /**
   * Currently, this needs to be manually called (e.g. for tests). Sentry SDK
   * does not support a teardown
   */
  public stop(reason?: string): void {
    if (!this._isEnabled) {
      return;
    }

    try {
      if (__DEBUG_BUILD__) {
        const msg = `[Replay] Stopping Replay${reason ? ` triggered by ${reason}` : ''}`;

        // When `traceInternals` is enabled, we want to log this to the console
        // Else, use the regular debug output
        // eslint-disable-next-line
        const log = this.getOptions()._experiments.traceInternals ? console.warn : logger.log;
        log(msg);
      }

      this._isEnabled = false;
      this._removeListeners();
      this.stopRecording();
      this.eventBuffer && this.eventBuffer.destroy();
      this.eventBuffer = null;
      this._debouncedFlush.cancel();
    } catch (err) {
      this._handleException(err);
    }
  }

  /**
   * Pause some replay functionality. See comments for `_isPaused`.
   * This differs from stop as this only stops DOM recording, it is
   * not as thorough of a shutdown as `stop()`.
   */
  public pause(): void {
    this._isPaused = true;
    this.stopRecording();
  }

  /**
   * Resumes recording, see notes for `pause().
   *
   * Note that calling `startRecording()` here will cause a
   * new DOM checkout.`
   */
  public resume(): void {
    if (!this._loadAndCheckSession()) {
      return;
    }

    this._isPaused = false;
    this.startRecording();
  }

  /**
   * We want to batch uploads of replay events. Save events only if
   * `<flushMinDelay>` milliseconds have elapsed since the last event
   * *OR* if `<flushMaxDelay>` milliseconds have elapsed.
   *
   * Accepts a callback to perform side-effects and returns true to stop batch
   * processing and hand back control to caller.
   */
  public addUpdate(cb: AddUpdateCallback): void {
    // We need to always run `cb` (e.g. in the case of `this.recordingMode == 'error'`)
    const cbResult = cb();

    // If this option is turned on then we will only want to call `flush`
    // explicitly
    if (this.recordingMode === 'error') {
      return;
    }

    // If callback is true, we do not want to continue with flushing -- the
    // caller will need to handle it.
    if (cbResult === true) {
      return;
    }

    // addUpdate is called quite frequently - use _debouncedFlush so that it
    // respects the flush delays and does not flush immediately
    this._debouncedFlush();
  }

  /**
   * Updates the user activity timestamp and resumes recording. This should be
   * called in an event handler for a user action that we consider as the user
   * being "active" (e.g. a mouse click).
   */
  public triggerUserActivity(): void {
    this._updateUserActivity();

    // This case means that recording was once stopped due to inactivity.
    // Ensure that recording is resumed.
    if (!this._stopRecording) {
      // Create a new session, otherwise when the user action is flushed, it
      // will get rejected due to an expired session.
      if (!this._loadAndCheckSession()) {
        return;
      }

      // Note: This will cause a new DOM checkout
      this.resume();
      return;
    }

    // Otherwise... recording was never suspended, continue as normalish
    this.checkAndHandleExpiredSession();

    this._updateSessionActivity();
  }

  /**
   *
   * Always flush via `_debouncedFlush` so that we do not have flushes triggered
   * from calling both `flush` and `_debouncedFlush`. Otherwise, there could be
   * cases of mulitple flushes happening closely together.
   */
  public flushImmediate(): Promise<void> {
    this._debouncedFlush();
    // `.flush` is provided by the debounced function, analogously to lodash.debounce
    return this._debouncedFlush.flush() as Promise<void>;
  }

  /** Get the current sesion (=replay) ID */
  public getSessionId(): string | undefined {
    return this.session && this.session.id;
  }

  /**
   * Checks if recording should be stopped due to user inactivity. Otherwise
   * check if session is expired and create a new session if so. Triggers a new
   * full snapshot on new session.
   *
   * Returns true if session is not expired, false otherwise.
   * @hidden
   */
  public checkAndHandleExpiredSession(): boolean | void {
    const oldSessionId = this.getSessionId();

    // Prevent starting a new session if the last user activity is older than
    // SESSION_IDLE_DURATION. Otherwise non-user activity can trigger a new
    // session+recording. This creates noisy replays that do not have much
    // content in them.
    if (
      this._lastActivity &&
      isExpired(this._lastActivity, this.timeouts.sessionIdle) &&
      this.session &&
      this.session.sampled === 'session'
    ) {
      // Pause recording only for session-based replays. Otherwise, resuming
      // will create a new replay and will conflict with users who only choose
      // to record error-based replays only. (e.g. the resumed replay will not
      // contain a reference to an error)
      this.pause();
      return;
    }

    // --- There is recent user activity --- //
    // This will create a new session if expired, based on expiry length
    if (!this._loadAndCheckSession()) {
      return;
    }

    // Session was expired if session ids do not match
    const expired = oldSessionId !== this.getSessionId();

    if (!expired) {
      return true;
    }

    // Session is expired, trigger a full snapshot (which will create a new session)
    this._triggerFullSnapshot();

    return false;
  }

  /**
   * Capture some initial state that can change throughout the lifespan of the
   * replay. This is required because otherwise they would be captured at the
   * first flush.
   */
  public setInitialState(): void {
    const urlPath = `${WINDOW.location.pathname}${WINDOW.location.hash}${WINDOW.location.search}`;
    const url = `${WINDOW.location.origin}${urlPath}`;

    this.performanceEvents = [];

    // Reset _context as well
    this._clearContext();

    this._context.initialUrl = url;
    this._context.initialTimestamp = Date.now();
    this._context.urls.push(url);
  }

  /** A wrapper to conditionally capture exceptions. */
  private _handleException(error: unknown): void {
    __DEBUG_BUILD__ && logger.error('[Replay]', error);

    if (__DEBUG_BUILD__ && this._options._experiments && this._options._experiments.captureExceptions) {
      captureException(error);
    }
  }

  /**
   * Loads (or refreshes) the current session.
   * Returns false if session is not recorded.
   */
  private _loadAndCheckSession(): boolean {
    const { type, session } = getSession({
      timeouts: this.timeouts,
      stickySession: Boolean(this._options.stickySession),
      currentSession: this.session,
      sessionSampleRate: this._options.sessionSampleRate,
      errorSampleRate: this._options.errorSampleRate,
    });

    // If session was newly created (i.e. was not loaded from storage), then
    // enable flag to create the root replay
    if (type === 'new') {
      this.setInitialState();
    }

    const currentSessionId = this.getSessionId();
    if (session.id !== currentSessionId) {
      session.previousSessionId = currentSessionId;
    }

    this.session = session;

    if (!this.session.sampled) {
      this.stop('session unsampled');
      return false;
    }

    return true;
  }

  /**
   * Adds listeners to record events for the replay
   */
  private _addListeners(): void {
    try {
      WINDOW.document.addEventListener('visibilitychange', this._handleVisibilityChange);
      WINDOW.addEventListener('blur', this._handleWindowBlur);
      WINDOW.addEventListener('focus', this._handleWindowFocus);

      // There is no way to remove these listeners, so ensure they are only added once
      if (!this._hasInitializedCoreListeners) {
        addGlobalListeners(this);

        this._hasInitializedCoreListeners = true;
      }
    } catch (err) {
      this._handleException(err);
    }

    // PerformanceObserver //
    if (!('PerformanceObserver' in WINDOW)) {
      return;
    }

    this._performanceObserver = setupPerformanceObserver(this);
  }

  /**
   * Cleans up listeners that were created in `_addListeners`
   */
  private _removeListeners(): void {
    try {
      WINDOW.document.removeEventListener('visibilitychange', this._handleVisibilityChange);

      WINDOW.removeEventListener('blur', this._handleWindowBlur);
      WINDOW.removeEventListener('focus', this._handleWindowFocus);

      if (this._performanceObserver) {
        this._performanceObserver.disconnect();
        this._performanceObserver = null;
      }
    } catch (err) {
      this._handleException(err);
    }
  }

  /**
   * Handle when visibility of the page content changes. Opening a new tab will
   * cause the state to change to hidden because of content of current page will
   * be hidden. Likewise, moving a different window to cover the contents of the
   * page will also trigger a change to a hidden state.
   */
  private _handleVisibilityChange: () => void = () => {
    if (WINDOW.document.visibilityState === 'visible') {
      this._doChangeToForegroundTasks();
    } else {
      this._doChangeToBackgroundTasks();
    }
  };

  /**
   * Handle when page is blurred
   */
  private _handleWindowBlur: () => void = () => {
    const breadcrumb = createBreadcrumb({
      category: 'ui.blur',
    });

    // Do not count blur as a user action -- it's part of the process of them
    // leaving the page
    this._doChangeToBackgroundTasks(breadcrumb);
  };

  /**
   * Handle when page is focused
   */
  private _handleWindowFocus: () => void = () => {
    const breadcrumb = createBreadcrumb({
      category: 'ui.focus',
    });

    // Do not count focus as a user action -- instead wait until they focus and
    // interactive with page
    this._doChangeToForegroundTasks(breadcrumb);
  };

  /**
   * Tasks to run when we consider a page to be hidden (via blurring and/or visibility)
   */
  private _doChangeToBackgroundTasks(breadcrumb?: Breadcrumb): void {
    if (!this.session) {
      return;
    }

    const expired = isSessionExpired(this.session, this.timeouts);

    if (breadcrumb && !expired) {
      this._createCustomBreadcrumb(breadcrumb);
    }

    // Send replay when the page/tab becomes hidden. There is no reason to send
    // replay if it becomes visible, since no actions we care about were done
    // while it was hidden
    this._conditionalFlush();
  }

  /**
   * Tasks to run when we consider a page to be visible (via focus and/or visibility)
   */
  private _doChangeToForegroundTasks(breadcrumb?: Breadcrumb): void {
    if (!this.session) {
      return;
    }

    const isSessionActive = this.checkAndHandleExpiredSession();

    if (!isSessionActive) {
      // If the user has come back to the page within SESSION_IDLE_DURATION
      // ms, we will re-use the existing session, otherwise create a new
      // session
      __DEBUG_BUILD__ && logger.log('[Replay] Document has become active, but session has expired');
      return;
    }

    if (breadcrumb) {
      this._createCustomBreadcrumb(breadcrumb);
    }
  }

  /**
   * Trigger rrweb to take a full snapshot which will cause this plugin to
   * create a new Replay event.
   */
  private _triggerFullSnapshot(checkout = true): void {
    try {
      __DEBUG_BUILD__ && logger.log('[Replay] Taking full rrweb snapshot');
      record.takeFullSnapshot(checkout);
    } catch (err) {
      this._handleException(err);
    }
  }

  /**
   * Update user activity (across session lifespans)
   */
  private _updateUserActivity(_lastActivity: number = Date.now()): void {
    this._lastActivity = _lastActivity;
  }

  /**
   * Updates the session's last activity timestamp
   */
  private _updateSessionActivity(_lastActivity: number = Date.now()): void {
    if (this.session) {
      this.session.lastActivity = _lastActivity;
      this._maybeSaveSession();
    }
  }

  /**
   * Helper to create (and buffer) a replay breadcrumb from a core SDK breadcrumb
   */
  private _createCustomBreadcrumb(breadcrumb: Breadcrumb): void {
    this.addUpdate(() => {
      void addEvent(this, {
        type: EventType.Custom,
        timestamp: breadcrumb.timestamp || 0,
        data: {
          tag: 'breadcrumb',
          payload: breadcrumb,
        },
      });
    });
  }

  /**
   * Observed performance events are added to `this.performanceEvents`. These
   * are included in the replay event before it is finished and sent to Sentry.
   */
  private _addPerformanceEntries(): Promise<Array<AddEventResult | null>> {
    // Copy and reset entries before processing
    const entries = [...this.performanceEvents];
    this.performanceEvents = [];

    return Promise.all(createPerformanceSpans(this, createPerformanceEntries(entries)));
  }

  /**
   * Only flush if `this.recordingMode === 'session'`
   */
  private _conditionalFlush(): void {
    if (this.recordingMode === 'error') {
      return;
    }

    void this.flushImmediate();
  }

  /**
   * Clear _context
   */
  private _clearContext(): void {
    // XXX: `initialTimestamp` and `initialUrl` do not get cleared
    this._context.errorIds.clear();
    this._context.traceIds.clear();
    this._context.urls = [];
    this._context.earliestEvent = null;
  }

  /**
   * Return and clear _context
   */
  private _popEventContext(): PopEventContext {
    if (this._context.earliestEvent && this._context.earliestEvent < this._context.initialTimestamp) {
      this._context.initialTimestamp = this._context.earliestEvent;
    }

    const _context = {
      initialTimestamp: this._context.initialTimestamp,
      initialUrl: this._context.initialUrl,
      errorIds: Array.from(this._context.errorIds).filter(Boolean),
      traceIds: Array.from(this._context.traceIds).filter(Boolean),
      urls: this._context.urls,
    };

    this._clearContext();

    return _context;
  }

  /**
   * Flushes replay event buffer to Sentry.
   *
   * Performance events are only added right before flushing - this is
   * due to the buffered performance observer events.
   *
   * Should never be called directly, only by `flush`
   */
  private async _runFlush(): Promise<void> {
    if (!this.session || !this.eventBuffer) {
      __DEBUG_BUILD__ && logger.error('[Replay] No session or eventBuffer found to flush.');
      return;
    }

    await this._addPerformanceEntries();

    // Check eventBuffer again, as it could have been stopped in the meanwhile
    if (!this.eventBuffer || !this.eventBuffer.hasEvents) {
      return;
    }

    // Only attach memory event if eventBuffer is not empty
    await addMemoryEntry(this);

    // Check eventBuffer again, as it could have been stopped in the meanwhile
    if (!this.eventBuffer) {
      return;
    }

    try {
      // Note this empties the event buffer regardless of outcome of sending replay
      const recordingData = await this.eventBuffer.finish();

      // NOTE: Copy values from instance members, as it's possible they could
      // change before the flush finishes.
      const replayId = this.session.id;
      const eventContext = this._popEventContext();
      // Always increment segmentId regardless of outcome of sending replay
      const segmentId = this.session.segmentId++;
      this._maybeSaveSession();

      await sendReplay({
        replayId,
        recordingData,
        segmentId,
        eventContext,
        session: this.session,
        options: this.getOptions(),
        timestamp: Date.now(),
      });
    } catch (err) {
      this._handleException(err);

      // This means we retried 3 times and all of them failed,
      // or we ran into a problem we don't want to retry, like rate limiting.
      // In this case, we want to completely stop the replay - otherwise, we may get inconsistent segments
      this.stop('sendReplay');

      const client = getCurrentHub().getClient();

      if (client) {
        client.recordDroppedEvent('send_error', 'replay');
      }
    }
  }

  /**
   * Flush recording data to Sentry. Creates a lock so that only a single flush
   * can be active at a time. Do not call this directly.
   */
  private _flush: () => Promise<void> = async () => {
    if (!this._isEnabled) {
      // This can happen if e.g. the replay was stopped because of exceeding the retry limit
      return;
    }

    if (!this.checkAndHandleExpiredSession()) {
      __DEBUG_BUILD__ && logger.error('[Replay] Attempting to finish replay event after session expired.');
      return;
    }

    if (!this.session) {
      __DEBUG_BUILD__ && logger.error('[Replay] No session found to flush.');
      return;
    }

    // A flush is about to happen, cancel any queued flushes
    this._debouncedFlush.cancel();

    // this._flushLock acts as a lock so that future calls to `_flush()`
    // will be blocked until this promise resolves
    if (!this._flushLock) {
      this._flushLock = this._runFlush();
      await this._flushLock;
      this._flushLock = null;
      return;
    }

    // Wait for previous flush to finish, then call the debounced `_flush()`.
    // It's possible there are other flush requests queued and waiting for it
    // to resolve. We want to reduce all outstanding requests (as well as any
    // new flush requests that occur within a second of the locked flush
    // completing) into a single flush.

    try {
      await this._flushLock;
    } catch (err) {
      __DEBUG_BUILD__ && logger.error(err);
    } finally {
      this._debouncedFlush();
    }
  };

  /** Save the session, if it is sticky */
  private _maybeSaveSession(): void {
    if (this.session && this._options.stickySession) {
      saveSession(this.session);
    }
  }

  /** Handler for rrweb.record.onMutation */
  private _onMutationHandler = (mutations: unknown[]): boolean => {
    const count = mutations.length;

    const mutationLimit = this._options._experiments.mutationLimit || 0;
    const mutationBreadcrumbLimit = this._options._experiments.mutationBreadcrumbLimit || 1000;
    const overMutationLimit = mutationLimit && count > mutationLimit;

    // Create a breadcrumb if a lot of mutations happen at the same time
    // We can show this in the UI as an information with potential performance improvements
    if (count > mutationBreadcrumbLimit || overMutationLimit) {
      const breadcrumb = createBreadcrumb({
        category: 'replay.mutations',
        data: {
          count,
        },
      });
      this._createCustomBreadcrumb(breadcrumb);
    }

    if (overMutationLimit) {
      // We want to skip doing an incremental snapshot if there are too many mutations
      // Instead, we do a full snapshot
      this._triggerFullSnapshot(false);
      return false;
    }

    // `true` means we use the regular mutation handling by rrweb
    return true;
  };
}

function _getExperimentalOptions(options: ReplayPluginOptions): ReplayExperimentalPluginOptions {
  const requestHeaders = options._experiments.captureRequestHeaders || [];
  const responseHeaders = options._experiments.captureResponseHeaders || [];
  const captureBodies = options._experiments.captureNetworkBodies || false;

  // Add defaults
  const defaultHeaders = ['content-length', 'content-type', 'accept'];

  return {
    network: {
      captureBodies,
      requestHeaders: [...defaultHeaders, ...requestHeaders.map(header => header.toLowerCase())],
      responseHeaders: [...defaultHeaders, ...responseHeaders.map(header => header.toLowerCase())],
    },
  };
}
