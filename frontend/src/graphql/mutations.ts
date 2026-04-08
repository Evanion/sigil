export const APPLY_OPERATIONS_MUTATION = `
  mutation ApplyOperations($operations: [OperationInput!]!, $userId: String!) {
    applyOperations(operations: $operations, userId: $userId) {
      seq
    }
  }
`;
