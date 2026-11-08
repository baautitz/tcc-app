import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Só o código-fonte: o `dist/` gerado pelo build não deve ser executado como teste.
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
