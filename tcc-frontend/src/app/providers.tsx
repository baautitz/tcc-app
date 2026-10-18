import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/modules/identity/hooks/AuthContext";
import { AiChatProvider } from "@/context/AiChatContext";
import { CurrentViewRefreshProvider } from "@/shared/context/CurrentViewRefreshContext";
import { ImperativeUIProvider } from "@/shared/context/ImperativeUIContext";
import { Toaster } from "@/shared/ui/toast";
import { TooltipProvider } from "@/shared/ui/tooltip";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter>
      <TooltipProvider>
        <Toaster>
          <AuthProvider>
            <ImperativeUIProvider>
              <AiChatProvider>
                <CurrentViewRefreshProvider>{children}</CurrentViewRefreshProvider>
              </AiChatProvider>
            </ImperativeUIProvider>
          </AuthProvider>
        </Toaster>
      </TooltipProvider>
    </BrowserRouter>
  );
}
