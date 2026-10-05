import { RefreshCw, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

export type Section = "users" | "permissions" | "sources" | "queries";
const sectionInfo: Record<Section, { title: string; description: string }> = {
  users: {
    title: "Usuários",
    description: "Identidades e permissões diretas de acesso.",
  },
  permissions: {
    title: "Permissões",
    description: "Catálogo de permissões disponíveis na plataforma.",
  },
  sources: {
    title: "Servidores PostgreSQL",
    description: "Fontes de dados externas com acesso somente leitura.",
  },
  queries: {
    title: "Queries",
    description: "Consultas SQL seguras executadas por UUID.",
  },
};
function SectionHeading({
  section,
  onCreate,
  onRefresh,
  loading,
}: {
  section: Section;
  onCreate: () => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const info = sectionInfo[section];
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">
          {info.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{info.description}</p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
          <span className="sr-only">Atualizar dados</span>
        </Button>
        {section !== "permissions" && (
          <Button onClick={onCreate}>
            <Plus /> Novo
          </Button>
        )}
      </div>
    </div>
  );
}

/** Cabeçalho + alerta de erro + conteúdo de uma seção administrativa. */
export function SectionLayout({
  section,
  onCreate,
  onRefresh,
  loading,
  error,
  children,
}: {
  section: Section;
  onCreate: () => void;
  onRefresh: () => void;
  loading: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        section={section}
        onCreate={onCreate}
        onRefresh={onRefresh}
        loading={loading}
      />
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Falha ao carregar administração</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {children}
    </div>
  );
}
