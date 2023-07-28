import type { Attributes, AttributeValue } from '@opentelemetry/api';
import { SpanKind } from '@opentelemetry/api';
import type { Span as OtelSpan } from '@opentelemetry/sdk-trace-base';
import { SemanticAttributes } from '@opentelemetry/semantic-conventions';
import type { TransactionSource } from '@sentry/types';
import { getSanitizedUrlString, parseUrl, stripUrlQueryAndFragment } from '@sentry/utils';

interface SpanDescription {
  op: string | undefined;
  description: string;
  source: TransactionSource;
  data?: Record<string, string>;
}

/**
 * Extract better op/description from an otel span.
 *
 * Based on https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/7422ce2a06337f68a59b552b8c5a2ac125d6bae5/exporter/sentryexporter/sentry_exporter.go#L306
 *
 * @param otelSpan
 * @returns Better op/description to use, or undefined
 */
export function parseSpanDescription(otelSpan: OtelSpan): SpanDescription {
  const { attributes, name } = otelSpan;

  // if http.method exists, this is an http request span
  const httpMethod = attributes[SemanticAttributes.HTTP_METHOD];
  if (httpMethod) {
    return descriptionForHttpMethod(otelSpan, httpMethod);
  }

  // If db.type exists then this is a database call span.
  const dbSystem = attributes[SemanticAttributes.DB_SYSTEM];
  if (dbSystem) {
    return descriptionForDbSystem(otelSpan, dbSystem);
  }

  // If rpc.service exists then this is a rpc call span.
  const rpcService = attributes[SemanticAttributes.RPC_SERVICE];
  if (rpcService) {
    return {
      op: 'rpc',
      description: name,
      source: 'route',
    };
  }

  // If messaging.system exists then this is a messaging system span.
  const messagingSystem = attributes[SemanticAttributes.MESSAGING_SYSTEM];
  if (messagingSystem) {
    return {
      op: 'message',
      description: name,
      source: 'route',
    };
  }

  // If faas.trigger exists then this is a function as a service span.
  const faasTrigger = attributes[SemanticAttributes.FAAS_TRIGGER];
  if (faasTrigger) {
    return { op: faasTrigger.toString(), description: name, source: 'route' };
  }

  return { op: undefined, description: name, source: 'custom' };
}

function descriptionForDbSystem(otelSpan: OtelSpan, _dbSystem: AttributeValue): SpanDescription {
  const { attributes, name } = otelSpan;

  // Use DB statement (Ex "SELECT * FROM table") if possible as description.
  const statement = attributes[SemanticAttributes.DB_STATEMENT];

  const description = statement ? statement.toString() : name;

  return { op: 'db', description, source: 'task' };
}

function descriptionForHttpMethod(otelSpan: OtelSpan, httpMethod: AttributeValue): SpanDescription {
  const { name, kind, attributes } = otelSpan;

  const opParts = ['http'];

  switch (kind) {
    case SpanKind.CLIENT:
      opParts.push('client');
      break;
    case SpanKind.SERVER:
      opParts.push('server');
      break;
  }

  const httpRoute = attributes[SemanticAttributes.HTTP_ROUTE];
  const { urlPath, url, query, fragment } = getSanitizedUrl(attributes, kind);

  if (!urlPath) {
    return { op: opParts.join('.'), description: name, source: 'custom' };
  }

  // Ex. description="GET /api/users".
  const description = `${httpMethod} ${urlPath}`;

  // If `httpPath` is a root path, then we can categorize the transaction source as route.
  const source: TransactionSource = httpRoute || urlPath === '/' ? 'route' : 'url';

  const data: Record<string, string> = {};

  if (url) {
    data.url = url;
  }
  if (query) {
    data['http.query'] = query;
  }
  if (fragment) {
    data['http.fragment'] = fragment;
  }

  return {
    op: opParts.join('.'),
    description,
    source,
    data,
  };
}

/** Exported for tests only */
export function getSanitizedUrl(
  attributes: Attributes,
  kind: SpanKind,
): {
  url: string | undefined;
  urlPath: string | undefined;
  query: string | undefined;
  fragment: string | undefined;
} {
  // This is the relative path of the URL, e.g. /sub
  const httpTarget = attributes[SemanticAttributes.HTTP_TARGET];
  // This is the full URL, including host & query params etc., e.g. https://example.com/sub?foo=bar
  const httpUrl = attributes[SemanticAttributes.HTTP_URL];
  // This is the normalized route name - may not always be available!
  const httpRoute = attributes[SemanticAttributes.HTTP_ROUTE];

  const parsedUrl = typeof httpUrl === 'string' ? parseUrl(httpUrl) : undefined;
  const url = parsedUrl ? getSanitizedUrlString(parsedUrl) : undefined;
  const query = parsedUrl && parsedUrl.search ? parsedUrl.search : undefined;
  const fragment = parsedUrl && parsedUrl.hash ? parsedUrl.hash : undefined;

  if (typeof httpRoute === 'string') {
    return { urlPath: httpRoute, url, query, fragment };
  }

  if (kind === SpanKind.SERVER && typeof httpTarget === 'string') {
    return { urlPath: stripUrlQueryAndFragment(httpTarget), url, query, fragment };
  }

  if (parsedUrl) {
    return { urlPath: url, url, query, fragment };
  }

  // fall back to target even for client spans, if no URL is present
  if (typeof httpTarget === 'string') {
    return { urlPath: stripUrlQueryAndFragment(httpTarget), url, query, fragment };
  }

  return { urlPath: undefined, url, query, fragment };
}
