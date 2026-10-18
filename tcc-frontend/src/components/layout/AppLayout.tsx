import { useEffect, useState } from "react";
import { useLocation, useNavigate, Outlet } from "react-router-dom";
import {
  Database,
  FileCode2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  UserRound,
  Users,
} from "lucide-react";
import { useAuth } from "@/modules/identity/hooks/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/shared/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar";
import { Separator } from "@/shared/ui/separator";
import { toast } from "@/shared/ui/toast";
import { AiChatDock, AiChatTrigger } from "@/modules/ai/components/AiChatDock";
import { useAiChat } from "@/modules/ai/hooks/AiChatContext";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { cn } from "@/shared/lib/utils";

function SidebarAutoClose() {
  const { setOpenMobile } = useSidebar();
  const location = useLocation();

  useEffect(() => {
    setOpenMobile(false);
  }, [location.pathname, setOpenMobile]);

  return null;
}

function getInitials(name?: string) {
  if (!name) {
    return "US";
  }

  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getPageTitle(pathname: string) {
  if (pathname === "/") {
    return "Dashboards";
  }

  if (pathname.startsWith("/dashboards/")) {
    return "Dashboard";
  }

  if (pathname.startsWith("/admin/dashboards/")) {
    return "Contexto do dashboard";
  }

  const administrationTitles: Record<string, string> = {
    "/admin/users": "Usuários",
    "/admin/permissions": "Permissões",
    "/admin/sources": "Servidores PostgreSQL",
    "/admin/queries": "Queries",
  };

  if (administrationTitles[pathname]) return administrationTitles[pathname];

  if (pathname.startsWith("/admin")) return "Administração";

  return "Painel de Controle";
}

function hasAdministrationAccess(permissions: string[]) {
  return permissions.includes("*") || permissions.some((permission) =>
    ["users:", "permissions:", "data-sources:", "queries:"].some((prefix) =>
      permission.startsWith(prefix),
    ),
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { isAiChatOpen, openAiChat, closeAiChat, toggleAiChat } = useAiChat();
  const [logoutPending, setLogoutPending] = useState(false);

  const handleLogout = async () => {
    setLogoutPending(true);
    closeAiChat();
    try {
      await logout();
      navigate("/login");
    } catch (reason) {
      setLogoutPending(false);
      toast.error(reason instanceof Error ? reason.message : "Não foi possível encerrar a sessão.");
    }
  };

  const canAdmin = Boolean(user && (user.isAdmin || hasAdministrationAccess(user.permissions)));

  return (
    <SidebarProvider className="h-dvh min-h-0 w-full overflow-hidden">
      <SidebarAutoClose />

      <Sidebar variant="sidebar" collapsible="icon">
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location.pathname === "/"}
                  tooltip="Dashboards"
                  onClick={() => navigate("/")}
                >
                  <LayoutDashboard className="size-4" />
                  <span>Dashboards</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>

          {canAdmin && (
            <SidebarGroup>
              <SidebarGroupLabel>Administração</SidebarGroupLabel>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={location.pathname === "/admin/users"}
                    tooltip="Usuários"
                    onClick={() => navigate("/admin/users")}
                  >
                    <Users className="size-4" />
                    <span>Usuários</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={location.pathname === "/admin/permissions"}
                    tooltip="Permissões"
                    onClick={() => navigate("/admin/permissions")}
                  >
                    <KeyRound className="size-4" />
                    <span>Permissões</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={location.pathname === "/admin/sources"}
                    tooltip="Servidores PostgreSQL"
                    onClick={() => navigate("/admin/sources")}
                  >
                    <Database className="size-4" />
                    <span>Servidores</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={location.pathname === "/admin/queries"}
                    tooltip="Queries"
                    onClick={() => navigate("/admin/queries")}
                  >
                    <FileCode2 className="size-4" />
                    <span>Queries</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          )}
        </SidebarContent>

        <SidebarFooter>
          {user && (
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <SidebarMenuButton size="lg">
                        <Avatar className="size-8">
                          <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                        </Avatar>
                        <div className="grid flex-1 text-left text-sm leading-tight">
                          <span className="truncate font-semibold">{user.name}</span>
                          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                        </div>
                        <UserRound className="ml-auto size-4" />
                      </SidebarMenuButton>
                    }
                  />
                  <DropdownMenuContent
                    className="min-w-56"
                    side="bottom"
                    align="end"
                    sideOffset={4}
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="p-0 font-normal">
                        <div className="flex items-center gap-2 px-2 py-2 text-left text-sm">
                          <Avatar className="size-8">
                            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                          </Avatar>
                          <div className="grid flex-1 text-left text-sm leading-tight">
                            <span className="truncate font-semibold">{user.name}</span>
                            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                          </div>
                        </div>
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      className="cursor-pointer"
                      onClick={() => void handleLogout()}
                    >
                      <LogOut className="size-4" />
                      Sair da plataforma
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </SidebarFooter>
      </Sidebar>

      <SidebarInset
        className={cn(
          "h-dvh min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          isMobile && isAiChatOpen && "hidden",
        )}
      >
        <header className="sticky top-0 z-50 flex h-14 shrink-0 items-center border-b border-border/50 bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/60 md:px-6">
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <SidebarTrigger className="-ml-1 size-8 shrink-0" />
            <Separator orientation="vertical" className="my-auto hidden h-4 sm:block" />
            <Breadcrumb className="min-w-0">
              <BreadcrumbList className="items-center">
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink
                    className="cursor-pointer text-sm"
                    onClick={() => navigate("/")}
                  >
                    Início
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="my-auto hidden self-center md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="truncate text-sm font-medium">
                    {getPageTitle(location.pathname)}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          {user?.isAdmin && !logoutPending && (
            <AiChatTrigger open={isAiChatOpen} onClick={toggleAiChat} />
          )}
        </header>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </SidebarInset>
      {user?.isAdmin && !logoutPending && (
        <AiChatDock
          open={isAiChatOpen}
          onOpenChange={(open) =>
            open ? openAiChat() : closeAiChat()
          }
        />
      )}
    </SidebarProvider>
  );
}
