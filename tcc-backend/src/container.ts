// Composição: monta adapters e services e injeta as portas entre módulos.
import { DrizzleAiContextProposalRepository } from "./modules/ai/infrastructure/ai-context-proposals-repository.js";
import { DrizzleAiDashboardToolsRepository } from "./modules/ai/infrastructure/ai-dashboard-tools-repository.js";
import { DrizzleAiReadToolsRepository } from "./modules/ai/infrastructure/ai-read-tools-repository.js";
import { AiChatToolsFactory } from "./modules/ai/application/chat/chat-tools.js";
import { DashboardProposalService } from "./modules/dashboards/application/dashboard-proposal-commit.js";
import { DashboardVisibilityService } from "./modules/dashboards/application/dashboard-visibility.js";
import { dashboardRegistry } from "./modules/dashboards/application/dashboard-registry.js";
import { DrizzleDashboardAccessRepository } from "./modules/dashboards/infrastructure/dashboard-access-repository.js";
import { DrizzleDashboardFilesRepository } from "./modules/dashboards/infrastructure/dashboard-files-repository.js";
import { dashboardFilesAdapter } from "./modules/dashboards/infrastructure/dashboard-files-adapter.js";
import { dataSourceAdminService } from "./modules/data-sources/application/data-source-admin.js";
import { externalSourceAdapter } from "./modules/data-sources/infrastructure/external-source-adapter.js";
import { QueryService } from "./modules/queries/application/query-admin.js";
import { queryLifecycleRepository } from "./modules/queries/infrastructure/query-lifecycle-repository.js";
import { savedQueriesAdapter } from "./modules/queries/infrastructure/saved-queries-adapter.js";
import { savedQueriesRepository } from "./modules/queries/infrastructure/saved-queries-repository.js";

export { dashboardRegistry };

export const queryService = new QueryService(
  savedQueriesRepository,
  queryLifecycleRepository,
  externalSourceAdapter,
  dashboardFilesAdapter,
  dataSourceAdminService,
);

export const dashboardVisibilityService = new DashboardVisibilityService(
  new DrizzleDashboardAccessRepository(),
  dashboardRegistry,
  savedQueriesAdapter,
);

export const dashboardProposalService = new DashboardProposalService(
  new DrizzleDashboardFilesRepository(),
  savedQueriesAdapter,
  externalSourceAdapter,
);

export const aiChatToolsFactory = new AiChatToolsFactory(
  new DrizzleAiReadToolsRepository(externalSourceAdapter, savedQueriesAdapter),
  new DrizzleAiDashboardToolsRepository(externalSourceAdapter),
  new DrizzleAiContextProposalRepository(),
  externalSourceAdapter,
);
