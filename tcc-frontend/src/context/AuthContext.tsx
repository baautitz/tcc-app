import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/api";
import type { CurrentUser } from "@/types";
type AuthContextValue = {
  user?: CurrentUser;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (...keys: string[]) => boolean;
};
const AuthContext = createContext<AuthContextValue | null>(null);
function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api
      .me()
      .then((response) => setUser(response.user))
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);
  const login = useCallback(async (email: string, password: string) => {
    const response = await api.login(email, password);
    setUser(response.user);
  }, []);
  const logout = useCallback(async () => {
    await api.logout();
    setUser(undefined);
  }, []);
  const hasPermission = useCallback(
    (...keys: string[]) =>
      Boolean(
        user &&
        (user.permissions.includes("*") ||
          keys.some((key) => user.permissions.includes(key))),
      ),
    [user],
  );
  const value = useMemo(
    () => ({ user, ready, login, logout, hasPermission }),
    [user, ready, login, logout, hasPermission],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context)
    throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return context;
}
export { AuthProvider, useAuth };
