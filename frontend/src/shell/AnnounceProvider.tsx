import { createContext, useContext, type ParentComponent } from "solid-js";

type AnnounceFn = (message: string) => void;

const AnnounceContext = createContext<AnnounceFn>();

export const AnnounceProvider: ParentComponent<{ announce: AnnounceFn }> = (props) => {
  return <AnnounceContext.Provider value={props.announce}>{props.children}</AnnounceContext.Provider>;
};

/**
 * Returns the announce function from the nearest AnnounceProvider.
 * Call `announce("message")` to push text into the ARIA live region.
 */
export function useAnnounce(): AnnounceFn {
  const ctx = useContext(AnnounceContext);
  if (!ctx) {
    throw new Error("useAnnounce must be used within an <AnnounceProvider>");
  }
  return ctx;
}
