import { useState } from "react";
import { api } from "@/api";
import type { DataSource, QuerySummary, SavedQuery } from "@/types";
import { toast } from "@/shared/ui/toast";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { errorMessage } from "@/lib/errors";
import { QueryEditor } from "@/features/queries/QueryEditor";
import { useLoad } from "@/shared/crud/useLoad";
import { useRemove } from "@/shared/crud/useRemove";
import { SectionLayout } from "../SectionLayout";
import { QueriesTable } from "./QueriesTable";

export function QueriesSection() {
  const isMobile = useIsMobile();
  // fontes alimentam o select do editor de queries
  const { data, loading, error, load } = useLoad(
    async () => {
      const [queries, sources] = await Promise.all([
        api.queries(),
        api.dataSources(),
      ]);
      return { queries, sources };
    },
    { queries: [] as QuerySummary[], sources: [] as DataSource[] },
    { reloadOn: "queries:saved" },
  );
  const remove = useRemove(load);
  const [sheet, setSheet] = useState<{ open: boolean; value?: SavedQuery }>({
    open: false,
  });
  const edit = async (id: string) => {
    try {
      setSheet({ open: true });
      const result = await api.savedQuery(id);
      setSheet({ open: true, value: result });
    } catch (reason) {
      toast.error(errorMessage(reason));
      setSheet({ open: false });
    }
  };
  return (
    <SectionLayout
      section="queries"
      onCreate={() => setSheet({ open: true })}
      onRefresh={() => void load()}
      loading={loading}
      error={error}
    >
      <QueriesTable
        queries={data.queries}
        loading={loading}
        isMobile={isMobile}
        onEdit={(id) => void edit(id)}
        onDelete={(value) =>
          void remove(
            value.name,
            () => api.deleteQuery(value.id),
            "Se a query estiver vinculada a dashboards, os componentes e mapeamentos que dependem dela também serão removidos. Os dashboards serão mantidos.",
          )
        }
      />
      <QueryEditor
        query={sheet.value}
        sources={data.sources}
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        onSaved={load}
      />
    </SectionLayout>
  );
}
