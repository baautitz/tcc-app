import { useState } from "react";
import { identityApi } from "@/modules/identity/api/identity.api";
import type { Permission } from "@/modules/identity/model/types";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { useLoad } from "@/shared/crud/useLoad";
import { SectionLayout } from "@/features/admin/SectionLayout";
import { PermissionSheet } from "@/modules/identity/components/PermissionSheet";
import { PermissionsTable } from "@/modules/identity/components/PermissionsTable";

export function PermissionsSection() {
  const isMobile = useIsMobile();
  const {
    data: permissions,
    loading,
    error,
    load,
  } = useLoad(() => identityApi.permissions(), [] as Permission[]);
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
