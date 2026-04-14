/**
 * Context for controlling the TokenEditor open/close state.
 *
 * This context bridges the TokensPanel (rendered through Dynamic without props)
 * and the TokenEditor (rendered in App.tsx at the shell level).
 */

import { createContext, useContext, type ParentComponent, type Accessor } from "solid-js";

export interface TokenEditorContextValue {
  /** Whether the full token editor window is open. */
  readonly isOpen: Accessor<boolean>;
  /** Open the token editor window. */
  readonly open: () => void;
  /** Close the token editor window. */
  readonly close: () => void;
}

const TokenEditorContext = createContext<TokenEditorContextValue>();

export const TokenEditorProvider: ParentComponent<{
  value: TokenEditorContextValue;
}> = (props) => {
  return (
    <TokenEditorContext.Provider value={props.value}>{props.children}</TokenEditorContext.Provider>
  );
};

/**
 * Access the token editor open/close control.
 * Must be used within a TokenEditorProvider.
 */
export function useTokenEditor(): TokenEditorContextValue {
  const ctx = useContext(TokenEditorContext);
  if (!ctx) {
    throw new Error("useTokenEditor must be used within a <TokenEditorProvider>");
  }
  return ctx;
}
