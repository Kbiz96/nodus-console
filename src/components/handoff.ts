import { createContext, useContext } from "react";

/**
 * Whether buttons that open a new Claude chat may show here. The main screens switch them off so each screen has
 * at most one hand-off to Claude; the Leads desk under More keeps them.
 */
export const HandoffContext = createContext(true);

export function useHandoffs(): boolean {
  return useContext(HandoffContext);
}
