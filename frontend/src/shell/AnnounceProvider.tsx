import { createContext, useContext, onCleanup, type ParentComponent } from "solid-js";

type AnnounceFn = (message: string) => void;

const AnnounceContext = createContext<AnnounceFn>();

/**
 * Provides an announce function for ARIA live region announcements.
 * Also listens for "sigil-announce-error" custom events dispatched by the
 * document store (which runs outside the component tree and cannot use
 * useAnnounce directly). See F-05.
 */
export const AnnounceProvider: ParentComponent<{ announce: AnnounceFn }> = (props) => {
  // F-05: Bridge store-level error events into the announce system
  const handleStoreError = (e: Event) => {
    const detail = (e as CustomEvent<{ message: string }>).detail;
    if (detail?.message) {
      props.announce(detail.message);
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("sigil-announce-error", handleStoreError);
    onCleanup(() => {
      window.removeEventListener("sigil-announce-error", handleStoreError);
    });
  }

  return (
    <AnnounceContext.Provider value={props.announce}>{props.children}</AnnounceContext.Provider>
  );
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
