import type { StructuredToolInterface } from "@langchain/core/tools";
import type { AuthenticatedUser } from "../../../identity/domain/auth-user.js";
import type { AiContextProposalRepository } from "../../domain/ai-context-proposals.js";
import { DrizzleAiContextProposalRepository } from "../../infrastructure/ai-context-proposals-repository.js";
import { DrizzleAiDashboardToolsRepository } from "../../infrastructure/ai-dashboard-tools-repository.js";
import { DrizzleAiReadToolsRepository } from "../../infrastructure/ai-read-tools-repository.js";
import { AiQuestionnaireTools } from "../ai-questionnaire.js";
import { ContextProposalTools } from "../context-proposals.js";
import { AiDashboardTools } from "../tools/ai-dashboard-tools.js";
import type { AiDashboardToolsRepository } from "../tools/ai-dashboard-tools.js";
import { AiQueryTestTools } from "../tools/ai-query-tools.js";
import { AiReadTools } from "../tools/ai-read-tools.js";
import type { AiQueryTestRepository } from "../tools/ai-query-tools.js";
import type {
  AiReadToolsRepository,
  AiToolProgressEvent,
} from "../tools/ai-read-tools.js";
import type { AiChatRequest } from "./chat-schemas.js";

/** Monta o conjunto de ferramentas do agente para uma requisição de chat. */
export class AiChatToolsFactory {
  constructor(
    private readonly readRepository: AiReadToolsRepository &
      AiQueryTestRepository,
    private readonly dashboardRepository: AiDashboardToolsRepository,
    private readonly proposalRepository: AiContextProposalRepository,
  ) {}

  create(options: {
    currentUser: AuthenticatedUser;
    pageContext?: AiChatRequest["pageContext"];
    onToolEvent: (event: AiToolProgressEvent) => void | Promise<void>;
  }): StructuredToolInterface[] {
    const { currentUser, pageContext, onToolEvent } = options;
    return [
      ...new AiQuestionnaireTools({
        currentUser,
        onQuestion: onToolEvent,
      }).tools(),
      ...new AiReadTools({
        currentUser,
        onToolEvent,
        repository: this.readRepository,
      }).tools(),
      ...new AiQueryTestTools({
        currentUser,
        onToolEvent,
        repository: this.readRepository,
      }).tools(),
      ...new AiDashboardTools({
        currentUser,
        pageDashboardId: pageContext?.dashboardId,
        onToolEvent,
        repository: this.dashboardRepository,
      }).tools(),
      ...new ContextProposalTools({
        currentUser,
        repository: this.proposalRepository,
        onProposal: onToolEvent,
      }).tools(),
    ];
  }
}

export const aiChatToolsFactory = new AiChatToolsFactory(
  new DrizzleAiReadToolsRepository(),
  new DrizzleAiDashboardToolsRepository(),
  new DrizzleAiContextProposalRepository(),
);
