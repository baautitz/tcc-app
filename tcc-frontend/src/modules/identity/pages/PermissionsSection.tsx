import { identityApi } from "@/modules/identity/api/identity.api";
import type { Permission } from "@/modules/identity/model/types";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { useLoad } from "@/shared/crud/useLoad";
import { SectionLayout } from "@/shared/layout/SectionLayout";
import { PermissionsTable } from "@/modules/identity/components/PermissionsTable";

export function PermissionsSection() {
  const isMobile = useIsMobile();
  const {
    data: permissions,
    loading,
    error,
    load,
  } = useLoad(() => identityApi.permissions(), [] as Permission[]);
  return (
    <SectionLayout
      section="permissions"
      onRefresh={() => void load()}
      loading={loading}
      error={error}
    >
      <PermissionsTable
        permissions={permissions}
        loading={loading}
        isMobile={isMobile}
      />
    </SectionLayout>
  );
}
