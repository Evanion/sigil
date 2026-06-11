export const DOCUMENT_QUERY = `
  query Document {
    document {
      name
      pageCount
      nodeCount
    }
  }
`;

export const PAGES_QUERY = `
  query Pages {
    pages {
      id
      name
      nodes {
        uuid
        name
        kind
        parent
        children
        transform
        style
        visible
        locked
      }
    }
  }
`;

export const TOKENS_QUERY = `
  query Tokens {
    tokens {
      id
      name
      tokenType
      value
      description
    }
  }
`;

export const NODE_QUERY = `
  query Node($uuid: String!) {
    node(uuid: $uuid) {
      uuid
      name
      kind
      parent
      children
      transform
      style
      visible
      locked
    }
  }
`;

/**
 * Query all font entries in the document font table.
 *
 * `fonts` is a JSON scalar — the server returns a JSON-encoded array of
 * FontEntry objects.  The frontend parses this with `parseFontsResponse`
 * in document-store-solid.tsx.  This matches the shape of the `add_font`
 * broadcast value (spec-fonts-1 Task 15a).
 */
export const FONTS_QUERY = `query Fonts { fonts }`;

/**
 * Query the raw font bytes for a single font entry by its stable UUID.
 *
 * The server returns the bytes as a base64-encoded string (GraphQL has no
 * binary scalar).  Returns `null` when the id refers to a non-Custom entry
 * (system_reference, bundled, library) or when no bytes are stored for the
 * id — both are non-error conditions.  An invalid UUID string produces a
 * GraphQL error.
 *
 * Consumers decode with `atob` / a Uint8Array helper and pass to `loadFonts`
 * via the `bytesById` map parameter (Task 17b font-loading orchestrator).
 */
export const FONT_BYTES_QUERY = `query FontBytes($id: String!) { fontBytes(id: $id) }`;
