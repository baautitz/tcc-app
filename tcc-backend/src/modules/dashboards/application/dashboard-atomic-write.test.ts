import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withDashboardFileCompensation, writeDashboardDocumentAtomically } from "../domain/dashboards.js";

const files: string[] = [];
const dashboardFolder = resolve(process.cwd(), "dashboards");

afterEach(async () => {
  await Promise.all(files.splice(0).map((file) => rm(file, { recursive: true, force: true })));
});

function document(id: string, name: string) {
  return {
    id,
    name,
    description: "",
    workspace: { params: [] },
    queryBindings: [],
    ui: { layout: { type: "grid", columns: 12, gap: 16 }, components: [] },
  };
}

describe("escrita atômica do documento do dashboard", () => {
  it("restaura o documento anterior quando a transação de catálogo falha", async () => {
    await mkdir(dashboardFolder, { recursive: true });
    const file = resolve(dashboardFolder, `tcc-ai-rollback-${randomUUID()}.json`);
    files.push(file);
    const id = randomUUID();
    const previous = document(id, "Antes");
    await writeFile(file, JSON.stringify(previous));

    const rollback = await writeDashboardDocumentAtomically(file, document(id, "Depois"));
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ name: "Depois" });
    await rollback();
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(previous);
  });

  it("remove o novo arquivo quando a criação no catálogo falha", async () => {
    await mkdir(dashboardFolder, { recursive: true });
    const file = resolve(dashboardFolder, `tcc-ai-create-rollback-${randomUUID()}.json`);
    files.push(file);
    const rollback = await writeDashboardDocumentAtomically(file, document(randomUUID(), "Cancelado"));
    await rollback();
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("falha visivelmente quando a compensação do arquivo não pode ser concluída", async () => {
    await mkdir(dashboardFolder, { recursive: true });
    const file = resolve(dashboardFolder, `tcc-ai-rollback-failure-${randomUUID()}.json`);
    files.push(file);
    const rollback = await writeDashboardDocumentAtomically(file, document(randomUUID(), "Documento"));
    await unlink(file);
    await mkdir(file);
    await writeFile(resolve(file, "keep"), "occupied");
    await expect(rollback()).rejects.toBeDefined();
  });

  it("remove o arquivo criado se o COMMIT externo falhar após o helper retornar", async () => {
    await mkdir(dashboardFolder, { recursive: true });
    const file = resolve(dashboardFolder, `tcc-ai-outer-commit-${randomUUID()}.json`);
    files.push(file);
    const created = await writeDashboardDocumentAtomically(file, document(randomUUID(), "Novo"));
    let rollback: (() => Promise<void>) | undefined = created;
    await expect(withDashboardFileCompensation(
      async () => { throw new Error("simulated outer transaction COMMIT failure"); },
      () => rollback,
    )).rejects.toThrow("simulated outer transaction COMMIT failure");
    rollback = undefined;
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
