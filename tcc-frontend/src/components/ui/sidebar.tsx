import { createContext, useCallback, useContext, useEffect, useMemo, useState, type HTMLAttributes, type ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
type ContextValue = { open: boolean; toggle: () => void; closeMobile: () => void };
const SidebarContext = createContext<ContextValue | null>(null);
function useSidebar() { const context = useContext(SidebarContext); if (!context) throw new Error("useSidebar deve ser usado dentro de SidebarProvider."); return context; }
function SidebarProvider({ children, className }: { children: ReactNode; className?: string }) { const isMobile = useIsMobile(); const [open, setOpen] = useState(true); const toggle = useCallback(() => setOpen((value) => !value), []); const closeMobile = useCallback(() => { if (isMobile) setOpen(false); }, [isMobile]); const value = useMemo(() => ({ open, toggle, closeMobile }), [open, toggle, closeMobile]); return <SidebarContext.Provider value={value}><div data-slot="sidebar-wrapper" className={cn("flex min-h-svh w-full bg-sidebar", className)}>{children}</div></SidebarContext.Provider>; }
function Sidebar({ children, className }: { children: ReactNode; className?: string }) { const { open } = useSidebar(); const isMobile = useIsMobile(); const contents = <div data-slot="sidebar-inner" className={cn("flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground", className)}>{children}</div>; if (isMobile) return <Sheet open={open} onOpenChange={() => undefined}><SheetContent side="left" className="w-64 max-w-none p-0 [&>button]:hidden">{contents}</SheetContent></Sheet>; return <aside data-slot="sidebar" className={cn("hidden shrink-0 transition-[width] duration-200 lg:block", open ? "w-64 p-2" : "w-0 overflow-hidden")}>{contents}</aside>; }
function SidebarTrigger({ className }: { className?: string }) { const { toggle } = useSidebar(); return <Button variant="ghost" size="icon" className={className} onClick={toggle}><PanelLeft /><span className="sr-only">Alternar navegação</span></Button>; }
function SidebarHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="sidebar-header" className={cn("p-2", className)} {...props} />; }
function SidebarContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="sidebar-content" className={cn("flex min-h-0 flex-1 flex-col overflow-auto", className)} {...props} />; }
function SidebarFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="sidebar-footer" className={cn("mt-auto p-2", className)} {...props} />; }
function SidebarGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="sidebar-group" className={cn("flex flex-col p-2", className)} {...props} />; }
function SidebarGroupLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div data-slot="sidebar-group-label" className={cn("h-8 px-2 text-xs text-sidebar-foreground/70", className)} {...props} />; }
function SidebarMenu({ className, ...props }: HTMLAttributes<HTMLUListElement>) { return <ul data-slot="sidebar-menu" className={cn("flex flex-col gap-1", className)} {...props} />; }
function SidebarMenuItem({ className, ...props }: HTMLAttributes<HTMLLIElement>) { return <li data-slot="sidebar-menu-item" className={className} {...props} />; }
function SidebarMenuButton({ className, isActive, ...props }: React.ComponentProps<typeof Button> & { isActive?: boolean }) { return <Button variant="ghost" className={cn("w-full justify-start", isActive && "bg-sidebar-accent text-sidebar-accent-foreground", className)} {...props} />; }
function SidebarInset({ className, ...props }: HTMLAttributes<HTMLElement>) { return <main data-slot="sidebar-inset" className={cn("flex min-w-0 flex-1 flex-col bg-background lg:m-2 lg:ml-0", className)} {...props} />; }
function SidebarAutoClose() { const { closeMobile } = useSidebar(); useEffect(() => closeMobile(), [closeMobile]); return null; }
export { SidebarProvider, Sidebar, SidebarTrigger, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarAutoClose, useSidebar };
