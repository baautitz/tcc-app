import { useState } from "react";
import { api } from "@/api";
import type { DataSource } from "@/types";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { useLoad } from "@/shared/crud/useLoad";
import { useRemove } from "@/shared/crud/useRemove";
import { SectionLayout } from "../SectionLayout";
import { SourceSheet } from "./SourceSheet";
import { SourcesTable } from "./SourcesTable";

export function SourcesSection() {
  const isMobile = useIsMobile();
  const [sheet, setSheet] = useState<{ open: boolean; value?: DataSource }>({
    open: false,
  });
  const {
    data: sources,
    loading,
    error,
    load,
  } = useLoad(() => api.dataSources(), [] as DataSource[], {
    // mantém o sheet aberto apontando para a versão atualizada da fonte
    onLoaded: (next) =>
      setSheet((current) =>
        current.value
          ? {
              ...current,
              value:
                next.find((source) => source.id === current.value?.id) ??
                current.value,
            }
          : current,
      ),
  });
  const remove = useRemove(load);
  return (
    <SectionLayout
      section="sources"
      onCreate={() => setSheet({ open: true })}
      onRefresh={() => void load()}
      loading={loading}
      error={error}
    >
      <SourcesTable
        sources={sources}
        loading={loading}
        isMobile={isMobile}
        onEdit={(value) => setSheet({ open: true, value })}
        onDelete={(value) =>
          void remove(value.name, () => api.deleteDataSource(value.id))
        }
      />
      <SourceSheet
        source={sheet.value}
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        onSaved={load}
      />
    </SectionLayout>
  );
}
