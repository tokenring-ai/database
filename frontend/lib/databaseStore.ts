import { useSyncExternalStore } from "react";

/**
 * State the Database views share. Each view is its own React subtree, so the
 * agent the dashboard is attached to (owned by the navigator) and requests to
 * attach to a freshly launched one (raised by a table panel) travel through
 * this tiny module store rather than through props. In memory only.
 */

export interface DatabaseAgentState {
  /** The agent the navigator's session list is attached to; null when none. */
  attachedAgentId: string | null;
  /** An agent a table panel just launched; the navigator picks it up and attaches. */
  requestedAgentId: string | null;
}

const INITIAL: DatabaseAgentState = { attachedAgentId: null, requestedAgentId: null };

let state: DatabaseAgentState = INITIAL;
const listeners = new Set<() => void>();

function update(next: DatabaseAgentState): void {
  if (next.attachedAgentId === state.attachedAgentId && next.requestedAgentId === state.requestedAgentId) return;
  state = next;
  for (const listener of listeners) listener();
}

export function useDatabaseAgentState(): DatabaseAgentState {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
    () => state,
  );
}

/** Called by the navigator whenever its agent selection changes. */
export function setAttachedDatabaseAgent(agentId: string | null): void {
  update({ ...state, attachedAgentId: agentId });
}

/** Called by a table panel after launching an agent with its selected rows. */
export function requestDatabaseAgent(agentId: string): void {
  update({ ...state, requestedAgentId: agentId });
}

export function clearDatabaseAgentRequest(): void {
  update({ ...state, requestedAgentId: null });
}

/** Test helper. */
export function resetDatabaseStore(): void {
  update(INITIAL);
}
