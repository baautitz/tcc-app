import { createContext, useContext, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
type TabsContextValue = { value: string; onValueChange: (value: string) => void };
const TabsContext = createContext<TabsContextValue | null>(null);
function Tabs({ value, onValueChange, className, children }: { value: string; onValueChange: (value: string) => void; className?: string; children: ReactNode }) { return <TabsContext.Provider value={{ value, onValueChange }}><div data-slot="tabs" className={cn("flex flex-col gap-4", className)}>{children}</div></TabsContext.Provider>; }
function TabsList({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="tabs-list" role="tablist" className={cn("inline-flex w-fit max-w-full overflow-x-auto bg-muted p-1", className)} {...props} />; }
function TabsTrigger({ value, className, children }: { value: string; className?: string; children: ReactNode }) { const context = useContext(TabsContext); if (!context) throw new Error("TabsTrigger deve estar dentro de Tabs."); return <button data-slot="tabs-trigger" role="tab" aria-selected={context.value === value} type="button" onClick={() => context.onValueChange(value)} className={cn("h-8 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground aria-selected:bg-background aria-selected:text-foreground", className)}>{children}</button>; }
function TabsContent({ value, className, ...props }: HTMLAttributes<HTMLDivElement> & { value: string }) { const context = useContext(TabsContext); if (!context || context.value !== value) return null; return <div data-slot="tabs-content" role="tabpanel" className={className} {...props} />; }
export { Tabs, TabsList, TabsTrigger, TabsContent };
