import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api } from "@/api";
import { AdminSectionPage } from "@/admin";
import { DashboardListPage, DashboardPage } from "@/dashboard";
import { DashboardContextEditor } from "@/features/dashboard/context-editor/DashboardContextEditor";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/context/AuthContext";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "@/shared/ui/toast";
import type { DashboardSummary } from "@/types";
import { LoginPage } from "./LoginPage";

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

