import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

type RefreshHandler = () => void;

type CurrentViewRefreshValue = {
  register: (handler: RefreshHandler) => () => void;
  refresh: () => boolean;
};

const CurrentViewRefreshContext = createContext<CurrentViewRefreshValue | null>(
  null,
);

export function CurrentViewRefreshProvider({
  children,
}: {
  children: ReactNode;
}) {
  const handlerRef = useRef<RefreshHandler | null>(null);

  const register = useCallback((handler: RefreshHandler) => {
    handlerRef.current = handler;
    return () => {
      if (handlerRef.current === handler) handlerRef.current = null;
    };
  }, []);

  const refresh = useCallback(() => {
    if (!handlerRef.current) return false;
    handlerRef.current();
    return true;
  }, []);

  const value = useMemo(() => ({ register, refresh }), [register, refresh]);

  return (
    <CurrentViewRefreshContext.Provider value={value}>
      {children}
    </CurrentViewRefreshContext.Provider>
  );
}

export function useRegisterCurrentViewRefresh(handler: RefreshHandler) {
  const context = useContext(CurrentViewRefreshContext);
  if (!context) {
    throw new Error(
      "useRegisterCurrentViewRefresh deve ser usado dentro do provider.",
    );
  }

  useEffect(() => context.register(handler), [context, handler]);
}

export function useCurrentViewRefresh() {
  const context = useContext(CurrentViewRefreshContext);
  if (!context) {
    throw new Error("useCurrentViewRefresh deve ser usado dentro do provider.");
  }
  return context.refresh;
}
