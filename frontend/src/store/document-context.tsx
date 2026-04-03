import { createContext, useContext, type ParentComponent } from "solid-js";
import type { DocumentStoreAPI } from "./document-store-solid";

const DocumentContext = createContext<DocumentStoreAPI>();

export const DocumentProvider: ParentComponent<{ store: DocumentStoreAPI }> = (props) => {
  return (
    <DocumentContext.Provider value={props.store}>
      {props.children}
    </DocumentContext.Provider>
  );
};

export function useDocument(): DocumentStoreAPI {
  const ctx = useContext(DocumentContext);
  if (!ctx) {
    throw new Error("useDocument must be used within a <DocumentProvider>");
  }
  return ctx;
}
