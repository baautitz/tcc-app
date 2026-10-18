const M = "^src/modules/";
const free = "^(src/(app|index|seed)\\.ts|tests/)";
module.exports = {
  forbidden: [
    { name: "no-cycles", severity: "error", from: {}, to: { circular: true } },
    { name: "domain-puro", severity: "error",
      from: { path: M + "([^/]+)/domain/" },
      to: { path: M + "$1/(application|infrastructure|http)/" } },
    { name: "application-sem-http", severity: "error",
      from: { path: M + "([^/]+)/application/" },
      to: { path: M + "$1/http/" } },
    // outro modulo so via domain/application (portas injetadas em app.ts)
    { name: "modulo-so-domain-application-de-outro", severity: "error",
      from: { path: M + "([^/]+)/", pathNot: free },
      to: { path: M + "[^/]+/(infrastructure|http)/", pathNot: M + "$1/" } },
    // direcao: identity <- data-sources / queries <- dashboards <- ai
    { name: "identity-folha", severity: "error",
      from: { path: M + "identity/" }, to: { path: M + "(data-sources|queries|dashboards|ai)/" } },
    { name: "data-sources-folha", severity: "error",
      from: { path: M + "data-sources/" },
      to: { path: M + "(identity|dashboards|ai)/|" + M + "queries/" } },
    { name: "queries-nao-importa-dashboards-ai", severity: "error",
      from: { path: M + "queries/" }, to: { path: M + "(dashboards|ai)/" } },
    { name: "dashboards-nao-importa-ai", severity: "error",
      from: { path: M + "dashboards/" }, to: { path: M + "ai/" } },
    { name: "shared-sem-modules", severity: "error",
      from: { path: "^src/shared/", pathNot: "^src/shared/middleware/auth\\.ts$" },
      to: { path: M } },
    { name: "shared-auth-so-identity", severity: "error",
      from: { path: "^src/shared/middleware/auth\\.ts$" },
      to: { path: M, pathNot: M + "identity/" } },
  ],
  options: { tsConfig: { fileName: "tsconfig.json" }, doNotFollow: { path: "node_modules" }, exclude: { path: "\\.test\\.ts$" } },
};
