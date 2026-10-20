import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/modules/identity/hooks/AuthContext";

type AiChatContextValue = {
  isAiChatOpen: boolean;
  openAiChat: () => void;
  closeAiChat: () => void;
  toggleAiChat: () => void;
};

const AiChatContext = createContext<AiChatContextValue | null>(null);

export function AiChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);

  const openAiChat = useCallback(() => {
    if (user?.isAdmin) setIsAiChatOpen(true);
  }, [user?.isAdmin]);

  const closeAiChat = useCallback(() => {
    setIsAiChatOpen(false);
  }, []);

  const toggleAiChat = useCallback(() => {
    setIsAiChatOpen((open) => (user?.isAdmin ? !open : false));
  }, [user?.isAdmin]);

  useEffect(() => {
    // fecha o chat ao perder permissao admin
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!user?.isAdmin) setIsAiChatOpen(false);
  }, [user?.isAdmin]);

  const value = useMemo(
    () => ({ isAiChatOpen, openAiChat, closeAiChat, toggleAiChat }),
    [isAiChatOpen, openAiChat, closeAiChat, toggleAiChat],
  );

  return (
    <AiChatContext.Provider value={value}>{children}</AiChatContext.Provider>
  );
}

export function useAiChat() {
  const context = useContext(AiChatContext);
  if (!context) {
    throw new Error("useAiChat deve ser usado dentro de AiChatProvider.");
  }
  return context;
}
