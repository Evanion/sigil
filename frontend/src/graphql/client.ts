import { Client, cacheExchange, fetchExchange, subscriptionExchange } from "urql";
import { createClient as createWSClient } from "graphql-ws";

/**
 * Creates a urql GraphQL client configured for:
 * - HTTP POST for queries and mutations (`/graphql`)
 * - WebSocket (graphql-ws protocol) for subscriptions (`/graphql/ws`)
 *
 * Protocol is auto-detected from `window.location`.
 */
export function createGraphQLClient(): Client {
  const httpUrl = `${window.location.origin}/graphql`;
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${window.location.host}/graphql/ws`;

  const wsClient = createWSClient({ url: wsUrl });

  return new Client({
    url: httpUrl,
    exchanges: [
      cacheExchange,
      subscriptionExchange({
        forwardSubscription(request) {
          const input = { ...request, query: request.query || "" };
          return {
            subscribe(sink) {
              const unsubscribe = wsClient.subscribe(input, sink);
              return { unsubscribe };
            },
          };
        },
      }),
      fetchExchange,
    ],
  });
}
