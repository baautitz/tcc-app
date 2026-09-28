import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { PanelTop } from "lucide-react";
import { api } from "@/api";
import { AdminSectionPage } from "@/admin";
import { DashboardListPage, DashboardPage } from "@/dashboard";
import { DashboardContextEditor } from "@/dashboard-context-editor";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ImperativeUIProvider } from "@/context/ImperativeUIContext";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster, toast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DashboardSummary } from "@/types";

const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});

type LoginForm = z.infer<typeof loginSchema>;

function LoginPage() {
  const { login } = useAuth();
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "admin@tcc.local",
      password: "Admin@123",
    },
  });

  const submit = async (values: LoginForm) => {
    try {
      await login(values.email, values.password);
      toast.success("Login realizado com sucesso.");
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Não foi possível entrar.");
    }
  };

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/20 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-col items-center justify-center pb-4 text-center">
          <div className="mb-2 flex size-8 items-center justify-center rounded-none bg-primary text-primary-foreground">
            <PanelTop className="size-4" />
          </div>
          <CardTitle className="text-xl font-bold">TCC Dashboards</CardTitle>
          <CardDescription>
            Acesse os dados liberados pelas suas permissões.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submit)}>
              <FieldGroup>
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-mail</FormLabel>
                      <FormControl>
                        <Input {...field} type="email" autoComplete="email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Senha</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          autoComplete="current-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="mt-2 w-full"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting ? "Autenticando..." : "Entrar"}
                </Button>
              </FieldGroup>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}

function HomeRoute() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .dashboards()
      .then((items) => {
        if (active) setDashboards(items);
      })
      .catch((reason: Error) => {
        if (active) {
          toast.error(reason.message || "Não foi possível carregar os dashboards.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return <DashboardListPage
    dashboards={dashboards}
    loading={loading}
    canCreate={Boolean(user?.isAdmin)}
    onOpen={(id) => navigate(`/dashboards/${id}`)}
  />;
}

function DashboardRoute() {
  const { id } = useParams();
  const navigate = useNavigate();

  return id ? (
    <DashboardPage dashboardId={id} onEditContext={() => navigate(`/admin/dashboards/${id}/context`)} />
  ) : (
    <Navigate to="/" replace />
  );
}

function DashboardContextEditorRoute() {
  const { id } = useParams();
  const navigate = useNavigate();

  return id ? (
    <DashboardContextEditor dashboardId={id} onBack={() => navigate(`/dashboards/${id}`)} />
  ) : (
    <Navigate to="/" replace />
  );
}

function ProtectedApp() {
  const { ready, user } = useAuth();

  if (!ready) {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </main>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/dashboards/:id" element={<DashboardRoute />} />
        <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
        <Route path="/admin/users" element={<AdminSectionPage section="users" />} />
        <Route path="/admin/permissions" element={<AdminSectionPage section="permissions" />} />
        <Route path="/admin/sources" element={<AdminSectionPage section="sources" />} />
        <Route path="/admin/dashboards/:id/context" element={<DashboardContextEditorRoute />} />
        <Route path="/admin/queries" element={<AdminSectionPage section="queries" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <TooltipProvider>
        <Toaster>
          <AuthProvider>
            <ImperativeUIProvider>
              <ProtectedApp />
            </ImperativeUIProvider>
          </AuthProvider>
        </Toaster>
      </TooltipProvider>
    </BrowserRouter>
  );
}

export default App;
