export const APPLY_OPERATIONS_MUTATION = `
  mutation ApplyOperations($operations: [OperationInput!]!, $userId: String!) {
    applyOperations(operations: $operations, userId: $userId) {
      seq
    }
  }
`;

/**
 * Add a font to the document's font library.
 *
 * `bytesBase64` — the raw font file bytes Base64-encoded.
 * `provenance`  — one of the FontProvenance variants (e.g. `"user_supplied"`).
 *
 * Returns the full FontEntry JSON scalar so the client can populate
 * `state.fontTable` without a separate re-fetch.  Parse the result via
 * `parseFontEntry`.
 */
export const ADD_FONT_MUTATION = `
  mutation AddFont($bytesBase64: String!, $provenance: String!) {
    addFont(bytesBase64: $bytesBase64, provenance: $provenance)
  }
`;

/**
 * Remove a font from the document's font library.
 *
 * The server validates that the entry is not the bundled default and is not
 * referenced by any text node before deleting.  Returns `true` on success.
 */
export const REMOVE_FONT_MUTATION = `
  mutation RemoveFont($id: String!) {
    removeFont(id: $id)
  }
`;
