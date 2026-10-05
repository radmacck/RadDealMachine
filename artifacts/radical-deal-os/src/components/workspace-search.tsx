import { createContext, useContext } from 'react';

type WorkspaceSearchState = {
  open: boolean;
  query: string;
  setQuery: (query: string) => void;
};

export const WorkspaceSearchContext = createContext<WorkspaceSearchState>({
  open: false,
  query: '',
  setQuery: () => undefined,
});

export function useWorkspaceSearch() {
  return useContext(WorkspaceSearchContext);
}
