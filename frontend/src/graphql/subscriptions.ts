/** @deprecated Phase 15d removes this. Use TRANSACTION_APPLIED_SUBSCRIPTION instead. */
export const DOCUMENT_CHANGED_SUBSCRIPTION = `
  subscription DocumentChanged {
    documentChanged {
      eventType
      uuid
      data
      senderId
    }
  }
`;

export const TRANSACTION_APPLIED_SUBSCRIPTION = `
  subscription TransactionApplied {
    transactionApplied {
      transactionId
      userId
      seq
      operations {
        id
        nodeUuid
        type
        path
        value
      }
      eventType
      uuid
    }
  }
`;
