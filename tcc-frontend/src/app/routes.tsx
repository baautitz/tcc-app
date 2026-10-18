import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { dashboardsApi } from "@/modules/dashboards/api/dashboards.api";
import { AdminSectionPage } from "@/app/admin/AdminPage";
import { DashboardListPage } from "@/modules/dashboards/pages/DashboardListPage";
import { DashboardPage } from "@/modules/dashboards/pages/DashboardPage";
import { DashboardContextEditor } from "@/modules/dashboards/components/context-editor/DashboardContextEditor";
import { AppLayout } from "@/app/layout/AppLayout";
import { useAuth } from "@/modules/identity/hooks/AuthContext";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/toast";
import type { DashboardSummary } from "@/modules/dashboards/model/types";
import { LoginPage } from "@/modules/identity/pages/LoginPage";

function HomeRoute() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    dashboardsApi
      .dashboards()
      .then((items) => {
        if (active) setDashboards(items);
      })
      .catch((reason: Error) => {
        if (active) {
          toast.error(
            reason.message || "Não foi possível carregar os dashboards.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <DashboardListPage
      dashboards={dashboards}
      loading={loading}
      canCreate={Boolean(user?.isAdmin)}
      onOpen={(id) => navigate(`/dashboards/${id}`)}
    />
  );
}

function DashboardRoute() {
  const { id } = useParams();
  const navigate = useNavigate();

  return id ? (
    <DashboardPage
      dashboardId={id}
      onEditContext={() => navigate(`/admin/dashboards/${id}/context`)}
    />
  ) : (
    <Navigate to="/" replace />
  );
}

function DashboardContextEditorRoute() {
  const { id } = useParams();
  const navigate = useNavigate();

  return id ? (
    <DashboardContextEditor
      dashboardId={id}
      onBack={() => navigate(`/dashboards/${id}`)}
    />
  ) : (
    <Navigate to="/" replace />
  );
}

export function ProtectedApp() {
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
        <Route
          path="/admin/users"
          element={<AdminSectionPage section="users" />}
        />
        <Route
          path="/admin/permissions"
          element={<AdminSectionPage section="permissions" />}
        />
        <Route
          path="/admin/sources"
          element={<AdminSectionPage section="sources" />}
        />
        <Route
          path="/admin/dashboards/:id/context"
          element={<DashboardContextEditorRoute />}
        />
        <Route
          path="/admin/queries"
          element={<AdminSectionPage section="queries" />}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

