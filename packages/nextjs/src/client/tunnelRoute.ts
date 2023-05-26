import type { BrowserOptions } from '@sentry/react';
import { dsnFromString, logger } from '@sentry/utils';

const globalWithInjectedValues = global as typeof global & {
  __sentryRewritesTunnelPath__?: string;
};

/**
 * Applies the `tunnel` option to the Next.js SDK options based on `withSentryConfig`'s `tunnelRoute` option.
 */
export function applyTunnelRouteOption(options: BrowserOptions): void {
  const tunnelRouteOption = globalWithInjectedValues.__sentryRewritesTunnelPath__;
  if (tunnelRouteOption && options.dsn) {
    const dsnComponents = dsnFromString(options.dsn);
    if (!dsnComponents) {
      return;
    }
    const sentrySaasDsnMatch = dsnComponents.host.match(/^o(\d+)\.ingest\.sentry\.io$/);
    if (sentrySaasDsnMatch) {
      const orgId = sentrySaasDsnMatch[1];
      const tunnelPath = `${tunnelRouteOption}?o=${orgId}&p=${dsnComponents.projectId}`;
      options.tunnel = tunnelPath;
      __DEBUG_BUILD__ && logger.info(`Tunneling events to "${tunnelPath}"`);
    } else {
      __DEBUG_BUILD__ && logger.warn('Provided DSN is not a Sentry SaaS DSN. Will not tunnel events.');
    }
  }
}
