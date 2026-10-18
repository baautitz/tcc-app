import { useState } from "react";
import { identityApi } from "@/modules/identity/api/identity.api";
import type { User } from "@/modules/identity/model/types";
import { useIsMobile } from "@/shared/hooks/use-mobile";
import { useLoad } from "@/shared/crud/useLoad";
import { useRemove } from "@/shared/crud/useRemove";
import { SectionLayout } from "@/features/admin/SectionLayout";
import { ChangePasswordDialog } from "@/modules/identity/components/ChangePasswordDialog";
import { UserSheet } from "@/modules/identity/components/UserSheet";
import { UsersTable } from "@/modules/identity/components/UsersTable";

export function UsersSection() {
  const isMobile = useIsMobile();
  // permissões alimentam os switches do sheet
  const { data, loading, error, load } = useLoad(
    async () => {
      const [users, permissions] = await Promise.all([
        identityApi.users(),
        identityApi.permissions(),
      ]);
      return { users, permissions };
    },
    { users: [], permissions: [] },
  );
  const remove = useRemove(load);
  const [sheet, setSheet] = useState<{ open: boolean; value?: User }>({
    open: false,
  });
  const [passwordDialog, setPasswordDialog] = useState<{
    open: boolean;
    value?: User;
  }>({ open: false });
  return (
    <SectionLayout
      section="users"
      onCreate={() => setSheet({ open: true })}
      onRefresh={() => void load()}
      loading={loading}
      error={error}
    >
      <UsersTable
        users={data.users}
        loading={loading}
        isMobile={isMobile}
        onEdit={(value) => setSheet({ open: true, value })}
        onChangePassword={(value) => setPasswordDialog({ open: true, value })}
        onDelete={(value) =>
          void remove(value.name, () => identityApi.deleteUser(value.id))
        }
      />
      <UserSheet
        user={sheet.value}
        permissions={data.permissions}
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        onSaved={load}
      />
      <ChangePasswordDialog
        user={passwordDialog.value}
        open={passwordDialog.open}
        onOpenChange={(open) =>
          setPasswordDialog((current) => ({ ...current, open }))
        }
      />
    </SectionLayout>
  );
}
