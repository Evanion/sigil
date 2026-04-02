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
