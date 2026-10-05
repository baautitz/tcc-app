import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/context/AuthContext";
import { AiChatProvider } from "@/context/AiChatContext";
import { CurrentViewRefreshProvider } from "@/context/CurrentViewRefreshContext";
import { ImperativeUIProvider } from "@/context/ImperativeUIContext";
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
