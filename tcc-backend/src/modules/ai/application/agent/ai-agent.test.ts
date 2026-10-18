import { describe, expect, it } from "vitest";
import { getEnvironment } from "../../../../shared/config/config.js";
import {
  createAiAgent,
  createAiAgentRunConfig,
  createAiModel,
  dashboardPreflightIssue,
  queryPreflightIssue,
  AI_MAX_OUTPUT_TOKENS,
  AI_AGENT_RECURSION_LIMIT,
  DEFAULT_AI_REQUEST_TIMEOUT_MS,
  getAiAvailability,
  resolveAiConfiguration,
} from "./ai-agent.js";

const configured = {
  AI_BASE_URL: "https://ai.example.test/v1",
  AI_API_KEY: "do-not-expose-this-key",
  AI_MODEL: "test-model",
  AI_REQUEST_TIMEOUT_MS: String(DEFAULT_AI_REQUEST_TIMEOUT_MS),
};

describe("configuração e factory da IA", () => {
  it("mantém a IA desabilitada quando os parâmetros não foram configurados", () => {
    expect(resolveAiConfiguration({})).toEqual({
      enabled: false,
      code: "AI_NOT_CONFIGURED",
      missing: ["AI_BASE_URL", "AI_API_KEY", "AI_MODEL"],
    });
  });

  it("permite iniciar a configuração da API sem variáveis de IA", () => {
    const environment = getEnvironment({
      DATABASE_URL: "postgres://tcc:tcc@localhost:5432/tcc",
      CREDENTIAL_ENCRYPTION_KEY: "test-encryption-key",
    });

    expect(environment.AI_BASE_URL).toBeUndefined();
    expect(environment.AI_API_KEY).toBeUndefined();
    expect(environment.AI_MODEL).toBeUndefined();
  });

  it("lista parâmetros ausentes sem incluir os valores configurados", () => {
    expect(resolveAiConfiguration({ AI_API_KEY: configured.AI_API_KEY })).toEqual({
      enabled: false,
      code: "AI_NOT_CONFIGURED",
      missing: ["AI_BASE_URL", "AI_MODEL"],
    });
  });

  it("rejeita uma URL incompatível sem fazer a configuração geral falhar", () => {
    expect(resolveAiConfiguration({ ...configured, AI_BASE_URL: "file:///tmp/ai" })).toEqual({
      enabled: false,
      code: "AI_CONFIGURATION_INVALID",
      message: "AI_BASE_URL deve ser uma URL HTTP ou HTTPS válida.",
    });
  });

  it("expõe status sem chave e cria um agente LangChain sem chamar o provedor", () => {
    const configuration = resolveAiConfiguration(configured);
    expect(configuration).toEqual({
      enabled: true,
      baseURL: configured.AI_BASE_URL,
      apiKey: configured.AI_API_KEY,
      model: configured.AI_MODEL,
      requestTimeoutMs: DEFAULT_AI_REQUEST_TIMEOUT_MS,
    });
    expect(getAiAvailability(configured)).toEqual({
      enabled: true,
      model: configured.AI_MODEL,
    });
    expect(JSON.stringify(getAiAvailability(configured))).not.toContain(configured.AI_API_KEY);

    if (!configuration.enabled) throw new Error("A configuração do teste deveria estar habilitada.");
    expect(typeof createAiAgent({ configuration }).stream).toBe("function");
    expect(createAiModel(configuration).maxTokens).toBe(AI_MAX_OUTPUT_TOKENS);
  });

  it("usa timeout padrão e valida o limite configurável sem derrubar a API", () => {
    const defaultTimeoutConfiguration = resolveAiConfiguration({
      AI_BASE_URL: configured.AI_BASE_URL,
      AI_API_KEY: configured.AI_API_KEY,
      AI_MODEL: configured.AI_MODEL,
    });
    expect(defaultTimeoutConfiguration).toMatchObject({ enabled: true, requestTimeoutMs: DEFAULT_AI_REQUEST_TIMEOUT_MS });
    expect(resolveAiConfiguration({ ...configured, AI_REQUEST_TIMEOUT_MS: "45000" })).toMatchObject({
      enabled: true,
      requestTimeoutMs: 45_000,
    });
    expect(resolveAiConfiguration({ ...configured, AI_REQUEST_TIMEOUT_MS: "999999" })).toMatchObject({
      enabled: false,
      code: "AI_CONFIGURATION_INVALID",
    });
  });

  it("reserva iterações para análise, refinamento de consultas complexas e revisão final", () => {
    expect(AI_AGENT_RECURSION_LIMIT).toBeGreaterThanOrEqual(40);
    expect(createAiAgentRunConfig({ signal: new AbortController().signal }, { isAdmin: true })).toMatchObject({
      recursionLimit: AI_AGENT_RECURSION_LIMIT,
      context: { isAdmin: true },
    });
  });
});

describe("pré-condições do fluxo de query e dashboard", () => {
  const dataSourceId = "00000000-0000-4000-8000-000000000020";
  const dashboardId = "00000000-0000-4000-8000-000000000021";

  it("mantém a prévia independente do dashboard aberto", () => {
    const issue = queryPreflightIssue([], {
      dataSourceId,
      sqlText: "SELECT 1 AS total",
      parameters: [],
    });

    expect(issue).toContain("liste as fontes disponíveis");
    expect(issue).not.toContain("leia o dashboard atual");
  });

  it("exige leitura do dashboard real antes da proposta de atualização", () => {
    const args = { mode: "update", dashboardId };
    expect(dashboardPreflightIssue([], args, { dashboardId })).toContain("leia o dashboard atual");
    expect(dashboardPreflightIssue([
      {
        type: "tool",
        name: "get_current_dashboard",
        content: JSON.stringify({ dashboardId }),
      },
    ], args, { dashboardId })).toBeUndefined();
    expect(dashboardPreflightIssue([
      {
        type: "tool",
        name: "get_current_dashboard",
        content: JSON.stringify({ dashboardId: "00000000-0000-4000-8000-000000000022" }),
      },
    ], args, { dashboardId })).toContain("leia o dashboard atual");
  });
});
