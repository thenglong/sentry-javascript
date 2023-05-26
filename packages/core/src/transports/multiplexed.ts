import type {
  BaseTransportOptions,
  Envelope,
  EnvelopeItemType,
  Event,
  EventItem,
  Transport,
  TransportMakeRequestResponse,
} from '@sentry/types';
import { dsnFromString, forEachEnvelopeItem } from '@sentry/utils';

import { getEnvelopeEndpointWithUrlEncodedAuth } from '../api';

interface MatchParam {
  /** The envelope to be sent */
  envelope: Envelope;
  /**
   * A function that returns an event from the envelope if one exists. You can optionally pass an array of envelope item
   * types to filter by - only envelopes matching the given types will be multiplexed.
   * Allowed values are: 'event', 'transaction', 'profile', 'replay_event'
   *
   * @param types Defaults to ['event']
   */
  getEvent(types?: EnvelopeItemType[]): Event | undefined;
}

type Matcher = (param: MatchParam) => string[];

function eventFromEnvelope(env: Envelope, types: EnvelopeItemType[]): Event | undefined {
  let event: Event | undefined;

  forEachEnvelopeItem(env, (item, type) => {
    if (types.includes(type)) {
      event = Array.isArray(item) ? (item as EventItem)[1] : undefined;
    }
    // bail out if we found an event
    return !!event;
  });

  return event;
}

/**
 * Creates a transport that can send events to different DSNs depending on the envelope contents.
 */
export function makeMultiplexedTransport<TO extends BaseTransportOptions>(
  createTransport: (options: TO) => Transport,
  matcher: Matcher,
): (options: TO) => Transport {
  return options => {
    const fallbackTransport = createTransport(options);
    const otherTransports: Record<string, Transport> = {};

    function getTransport(dsn: string): Transport | undefined {
      if (!otherTransports[dsn]) {
        const validatedDsn = dsnFromString(dsn);
        if (!validatedDsn) {
          return undefined;
        }
        const url = getEnvelopeEndpointWithUrlEncodedAuth(validatedDsn);
        otherTransports[dsn] = createTransport({ ...options, url });
      }

      return otherTransports[dsn];
    }

    async function send(envelope: Envelope): Promise<void | TransportMakeRequestResponse> {
      function getEvent(types?: EnvelopeItemType[]): Event | undefined {
        const eventTypes: EnvelopeItemType[] = types && types.length ? types : ['event'];
        return eventFromEnvelope(envelope, eventTypes);
      }

      const transports = matcher({ envelope, getEvent })
        .map(dsn => getTransport(dsn))
        .filter((t): t is Transport => !!t);

      // If we have no transports to send to, use the fallback transport
      if (transports.length === 0) {
        transports.push(fallbackTransport);
      }

      const results = await Promise.all(transports.map(transport => transport.send(envelope)));

      return results[0];
    }

    async function flush(timeout: number | undefined): Promise<boolean> {
      const allTransports = [...Object.keys(otherTransports).map(dsn => otherTransports[dsn]), fallbackTransport];
      const results = await Promise.all(allTransports.map(transport => transport.flush(timeout)));
      return results.every(r => r);
    }

    return {
      send,
      flush,
    };
  };
}
