import { useState } from "react";
import { api } from "@/api";
import type { Permission } from "@/types";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { useLoad } from "@/shared/crud/useLoad";
import { SectionLayout } from "../SectionLayout";
import { PermissionSheet } from "./PermissionSheet";
import { PermissionsTable } from "./PermissionsTable";

export function PermissionsSection() {
  const isMobile = useIsMobile();
  const {
    data: permissions,
    loading,
    error,
    load,
  } = useLoad(() => api.permissions(), [] as Permission[]);
  const [sheet, setSheet] = useState<{ open: boolean; value?: Permission }>({
    open: false,
  });
  return (
    <SectionLayout
      section="permissions"
      onCreate={() => setSheet({ open: true })}
      onRefresh={() => void load()}
      loading={loading}
      error={error}
    >
      <PermissionsTable
        permissions={permissions}
        loading={loading}
        isMobile={isMobile}
        onEdit={(value) => setSheet({ open: true, value })}
      />
      <PermissionSheet
        permission={sheet.value}
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        onSaved={load}
      />
    </SectionLayout>
  );
}
