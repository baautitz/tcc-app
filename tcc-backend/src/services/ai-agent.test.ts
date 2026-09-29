import { describe, expect, it } from "vitest";
import { getEnvironment } from "../config.js";
import {
  createAiAgent,
  getAiAvailability,
  resolveAiConfiguration,
} from "./ai-agent.js";

const configured = {
  AI_BASE_URL: "https://ai.example.test/v1",
  AI_API_KEY: "do-not-expose-this-key",
  AI_MODEL: "test-model",
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
    });
    expect(getAiAvailability(configured)).toEqual({
      enabled: true,
      model: configured.AI_MODEL,
    });
    expect(JSON.stringify(getAiAvailability(configured))).not.toContain(configured.AI_API_KEY);

    if (!configuration.enabled) throw new Error("A configuração do teste deveria estar habilitada.");
    expect(typeof createAiAgent({ configuration }).stream).toBe("function");
  });
});
