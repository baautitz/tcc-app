import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { PanelTop } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { FieldGroup } from "@/shared/ui/field";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/ui/form";
import { Input } from "@/shared/ui/input";
import { toast } from "@/shared/ui/toast";

const loginSchema = z.object({
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
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
      toast.error(
        reason instanceof Error ? reason.message : "Não foi possível entrar.",
      );
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

