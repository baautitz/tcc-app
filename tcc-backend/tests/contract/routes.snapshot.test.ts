import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { app } from "../../src/app.js";

const file = new URL("./routes.snapshot.txt", import.meta.url);

// Para atualizar após mudar rotas de propósito: UPDATE_ROUTES=1 pnpm vitest run tests/contract
it("lista de rotas (método + path, ordem de montagem) não mudou", () => {
  const actual =
    app.routes.map((r) => `${r.method} ${r.path}`).join("\n") + "\n";
  if (process.env.UPDATE_ROUTES === "1") {
    writeFileSync(file, actual);
  }
  expect(actual).toBe(readFileSync(file, "utf8"));
});
