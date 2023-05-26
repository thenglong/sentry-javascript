import { GLOBAL_OBJ } from '@sentry/utils';

// exporting a separate copy of `WINDOW` rather than exporting the one from `@sentry/browser`
// prevents the browser package from being bundled in the CDN bundle, and avoids a
// circular dependency between the browser and replay packages should `@sentry/browser` import
// from `@sentry/replay` in the future
export const WINDOW = GLOBAL_OBJ as typeof GLOBAL_OBJ & Window;

export const REPLAY_SESSION_KEY = 'sentryReplaySession';
export const REPLAY_EVENT_NAME = 'replay_event';
export const RECORDING_EVENT_NAME = 'replay_recording';
export const UNABLE_TO_SEND_REPLAY = 'Unable to send Replay';

// The idle limit for a session after which recording is paused.
export const SESSION_IDLE_PAUSE_DURATION = 300_000; // 5 minutes in ms

// The idle limit for a session after which the session expires.
export const SESSION_IDLE_EXPIRE_DURATION = 900_000; // 15 minutes in ms

// The maximum length of a session
export const MAX_SESSION_LIFE = 3_600_000; // 60 minutes in ms

/** Default flush delays */
export const DEFAULT_FLUSH_MIN_DELAY = 5_000;
// XXX: Temp fix for our debounce logic where `maxWait` would never occur if it
// was the same as `wait`
export const DEFAULT_FLUSH_MAX_DELAY = 5_500;

/* How long to wait for error checkouts */
export const BUFFER_CHECKOUT_TIME = 60_000;

export const RETRY_BASE_INTERVAL = 5000;
export const RETRY_MAX_COUNT = 3;

/* The max (uncompressed) size in bytes of a network body. Any body larger than this will be truncated. */
export const NETWORK_BODY_MAX_SIZE = 150_000;

/* The max size of a single console arg that is captured. Any arg larger than this will be truncated. */
export const CONSOLE_ARG_MAX_SIZE = 5_000;
