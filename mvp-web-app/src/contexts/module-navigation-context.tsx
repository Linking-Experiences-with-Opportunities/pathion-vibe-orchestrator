"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface ModuleNavigationState {
  currentIndex: number;
  totalCount: number;
  moduleTitle: string;
  currentLessonTitle: string;
  moduleNumber: number; // 1-indexed position of module in curriculum
}

interface ModuleNavigationContextType {
  navigationState: ModuleNavigationState | null;
  setNavigationState: (state: ModuleNavigationState | null) => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  setNavigationHandlers: (handlers: { onPrev: () => void; onNext: () => void }) => void;
  clearNavigation: () => void;
}

const ModuleNavigationContext = createContext<ModuleNavigationContextType>({
  navigationState: null,
  setNavigationState: () => {},
  onPrev: null,
  onNext: null,
  setNavigationHandlers: () => {},
  clearNavigation: () => {},
});

export function ModuleNavigationProvider({ children }: { children: ReactNode }) {
  const [navigationState, setNavigationState] = useState<ModuleNavigationState | null>(null);
  const [handlers, setHandlers] = useState<{ onPrev: () => void; onNext: () => void } | null>(null);

  const setNavigationHandlers = useCallback((newHandlers: { onPrev: () => void; onNext: () => void }) => {
    setHandlers(newHandlers);
  }, []);

  const clearNavigation = useCallback(() => {
    setNavigationState(null);
    setHandlers(null);
  }, []);

  return (
    <ModuleNavigationContext.Provider
      value={{
        navigationState,
        setNavigationState,
        onPrev: handlers?.onPrev ?? null,
        onNext: handlers?.onNext ?? null,
        setNavigationHandlers,
        clearNavigation,
      }}
    >
      {children}
    </ModuleNavigationContext.Provider>
  );
}

export const useModuleNavigation = () => useContext(ModuleNavigationContext);
