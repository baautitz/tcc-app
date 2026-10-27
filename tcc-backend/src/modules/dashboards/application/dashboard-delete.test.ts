import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeDashboardFile } from "../domain/dashboards.js";

const files: string[] = [];
const dashboardFolder = resolve(process.cwd(), "dashboards");

afterEach(async () => {
  await Promise.all(files.splice(0).map((file) => rm(file, { force: true })));
});

async function dashboardFile(content: string) {
  await mkdir(dashboardFolder, { recursive: true });
  const file = resolve(dashboardFolder, `tcc-delete-${randomUUID()}.json`);
  files.push(file);
  await writeFile(file, content);
  return file;
}

const exists = (file: string) =>
  readFile(file).then(
    () => true,
    () => false,
  );

describe("remoção do arquivo do dashboard", () => {
  it("apaga o arquivo e o rollback o devolve idêntico", async () => {
    const file = await dashboardFile('{"name":"Teste"}\n');

    const rollback = await removeDashboardFile(file);
    expect(await exists(file)).toBe(false);

    await rollback();
    expect(await readFile(file, "utf8")).toBe('{"name":"Teste"}\n');
  });

  it("não falha se o arquivo já não existe", async () => {
    const file = resolve(dashboardFolder, `tcc-delete-${randomUUID()}.json`);
    const rollback = await removeDashboardFile(file);
    await rollback();
    expect(await exists(file)).toBe(false);
  });

  it("recusa caminho fora da pasta dashboards", async () => {
    await expect(removeDashboardFile("/etc/hostname")).rejects.toThrow(
      /pasta dashboards/,
    );
  });
});
