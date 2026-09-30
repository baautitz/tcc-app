import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  dashboardArgumentSchema,
  dashboardDocumentSchema,
  queryBindingSchema,
} from "../lib/contracts.js";
import type { DashboardDocument } from "./dashboards.js";

const gapSchema = z.union([
  z.literal(2), z.literal(4), z.literal(8), z.literal(12),
  z.literal(16), z.literal(20), z.literal(24), z.literal(32),
]);
const componentBase = {
  id: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(160),
  queryUuid: z.string().uuid(),
  colSpan: z.number().int().min(1).max(12).default(12),
};
const aiComponentSchema = z.discriminatedUnion("component", [
  z.object({
    ...componentBase,
    component: z.literal("stat_card"),
    field: z.string().trim().min(1).max(160),
    format: z.enum(["number", "currency"]).default("number"),
  }).strict(),
  z.object({
    ...componentBase,
    component: z.literal("bar_chart"),
    nameKey: z.string().trim().min(1).max(160),
    valueKey: z.string().trim().min(1).max(160),
  }).strict(),
  z.object({
    ...componentBase,
    component: z.literal("pie_chart"),
    nameKey: z.string().trim().min(1).max(160),
    valueKey: z.string().trim().min(1).max(160),
  }).strict(),
  z.object({
    ...componentBase,
    component: z.literal("data_table"),
    columns: z.array(z.object({ key: z.string().trim().min(1).max(160) }).strict()).min(1).max(30),
  }).strict(),
]);

export const aiDashboardProposalInputSchema = z.object({
  mode: z.enum(["create", "update"]),
  dashboardId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  gap: gapSchema.optional(),
  workspace: z.object({ params: z.array(dashboardArgumentSchema).max(30).default([]) }).strict().default({ params: [] }),
  queryBindings: z.array(queryBindingSchema).max(50).default([]),
  components: z.array(aiComponentSchema).max(24).default([]),
  removeComponentIds: z.array(z.string().trim().min(1).max(160)).max(24).default([]),
  contextValues: z.record(z.string().max(80), z.union([z.string().max(2048), z.array(z.string().max(2048)).max(50)])).default({}),
}).strict().superRefine((proposal, context) => {
  if (proposal.mode === "update" && !proposal.dashboardId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dashboardId"], message: "Informe o dashboard que será alterado." });
  }
  if (proposal.mode === "create" && proposal.dashboardId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dashboardId"], message: "Uma proposta de criação não pode indicar dashboard existente." });
  }
  if (proposal.mode === "create" && proposal.components.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["components"], message: "Uma proposta de criação precisa adicionar ao menos um componente." });
  }
  if (proposal.mode === "create" && proposal.removeComponentIds.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["removeComponentIds"], message: "Uma proposta de criação não pode remover componentes existentes." });
  }
  if (proposal.mode === "update" && proposal.components.length === 0 && proposal.removeComponentIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["components"], message: "Informe componentes para adicionar/alterar ou IDs para remover." });
  }
  const ids = new Set<string>();
  for (const [index, component] of proposal.components.entries()) {
    if (ids.has(component.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["components", index, "id"], message: "IDs de componentes devem ser únicos." });
    ids.add(component.id);
  }
  const removedIds = new Set<string>();
  for (const [index, id] of proposal.removeComponentIds.entries()) {
    if (removedIds.has(id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["removeComponentIds", index], message: "IDs para remoção devem ser únicos." });
    if (ids.has(id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["removeComponentIds", index], message: "Um componente não pode ser alterado e removido na mesma proposta." });
    removedIds.add(id);
  }
});

export type AiDashboardProposalInput = z.infer<typeof aiDashboardProposalInputSchema>;
export type DashboardComponentChange = "added" | "modified" | "unchanged";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort((left, right) => left.localeCompare(right, "en-US")).map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function countChanges<T>(
  before: T[],
  after: T[],
  key: (value: T) => string,
  describe: (value: T) => string,
): { added: string[]; removed: string[]; changed: string[] } {
  const oldByKey = new Map(before.map((value) => [key(value), stableJson(value)]));
  const newByKey = new Map(after.map((value) => [key(value), stableJson(value)]));
  const beforeByKey = new Map(before.map((value) => [key(value), value]));
  const afterByKey = new Map(after.map((value) => [key(value), value]));
  const changed: string[] = [];
  for (const [id, value] of newByKey) {
    if (oldByKey.has(id) && oldByKey.get(id) !== value) changed.push(describe(afterByKey.get(id)!));
  }
  return {
    added: [...newByKey.keys()].filter((id) => !oldByKey.has(id)).map((id) => describe(afterByKey.get(id)!)),
    removed: [...oldByKey.keys()].filter((id) => !newByKey.has(id)).map((id) => describe(beforeByKey.get(id)!)),
    changed,
  };
}

export function summarizeDashboardChanges(
  next: DashboardDocument,
  previous?: DashboardDocument,
): string[] {
  const displayValue = (value: string) => {
    const normalized = value.replace(/\s+/g, " ").trim() || "(vazio)";
    return normalized.length > 120 ? `${normalized.slice(0, 117)}…` : normalized;
  };
  const components = countChanges(
    previous?.ui.components ?? [],
    next.ui.components,
    (component) => component.id,
    (component) => `${String(component.props.title ?? component.id)} (${component.component})`,
  );
  const params = countChanges(
    previous?.workspace.params ?? [],
    next.workspace.params,
    (parameter) => parameter.name,
    (parameter) => `${parameter.label} (${parameter.name}, ${parameter.type})`,
  );
  const bindings = countChanges(
    previous?.queryBindings ?? [],
    next.queryBindings,
    (binding) => binding.queryUuid,
    (binding) => `${binding.queryUuid.slice(0, 8)}… → ${Object.keys(binding.parameters).join(", ") || "sem parâmetros"}`,
  );
  const previousComponentIds = previous?.ui.components.map((component) => component.id) ?? [];
  const nextComponentIds = next.ui.components.map((component) => component.id);
  const componentOrderChanged = Boolean(previous) &&
    previousComponentIds.join("\u0000") !== nextComponentIds.join("\u0000");
  const orderSummary = componentOrderChanged
    ? ` Ordem proposta: ${next.ui.components.map((component) => String(component.props.title ?? component.id)).join(" → ") || "nenhum componente"}.`
    : "";
  const describe = (label: string, change: typeof components) => {
    const parts = [
      change.added.length ? `adicionados: ${change.added.join("; ")}` : "",
      change.changed.length ? `alterados: ${change.changed.join("; ")}` : "",
      change.removed.length ? `removidos: ${change.removed.join("; ")}` : "",
    ].filter(Boolean);
    return `${label}: ${parts.length ? parts.join(" · ") : "sem alterações"}.`;
  };
  return [
    `Nome do dashboard: ${previous ? `“${displayValue(previous.name)}”` : "(novo)"} → “${displayValue(next.name)}”.`,
    `Descrição: ${previous ? `“${displayValue(previous.description ?? "")}”` : "(nova)"} → “${displayValue(next.description ?? "")}”.`,
    `Espaçamento (gap): ${previous ? String(previous.ui.layout.gap) : "(novo)"} → ${String(next.ui.layout.gap)}.`,
    `${describe("Componentes", components)}${orderSummary}`,
    describe("Filtros do dashboard", params),
    describe("Mapeamentos de parâmetros das queries", bindings),
  ];
}

export function dashboardComponentChanges(
  next: DashboardDocument,
  previous?: DashboardDocument,
): Record<string, DashboardComponentChange> {
  const previousById = new Map(
    (previous?.ui.components ?? []).map((component) => [component.id, component]),
  );
  return Object.fromEntries(next.ui.components.map((component) => {
    const before = previousById.get(component.id);
    const status: DashboardComponentChange = !before
      ? "added"
      : stableJson(before) === stableJson(component)
        ? "unchanged"
        : "modified";
    return [component.id, status];
  }));
}

export function createDashboardDocument(
  input: AiDashboardProposalInput,
  dashboardId: string,
  previous?: DashboardDocument,
): DashboardDocument {
  const mergeBy = <T,>(existing: T[], proposed: T[], key: (item: T) => string) => {
    const merged = new Map<string, T>();
    existing.forEach((item) => merged.set(key(item), item));
    proposed.forEach((item) => merged.set(key(item), item));
    return [...merged.values()];
  };
  const workspaceParams = mergeBy(
    input.mode === "update" ? previous?.workspace.params ?? [] : [],
    input.workspace.params,
    (parameter) => parameter.name,
  );
  const mergedQueryBindings = mergeBy(
    input.mode === "update" ? previous?.queryBindings ?? [] : [],
    input.queryBindings,
    (binding) => binding.queryUuid,
  );
  const proposedComponents = input.components.map((component) => {
    const { id, component: kind, queryUuid, title, colSpan, ...config } = component;
    const props = { ...config, title, queryUuid };
    return {
      id,
      component: kind,
      // The current renderer uses colSpan only. rowSpan is fixed to one.
      layoutProps: { colSpan, rowSpan: 1 },
      props,
    };
  });
  const existingComponents = input.mode === "update" ? previous?.ui.components ?? [] : [];
  const existingComponentIds = new Set(existingComponents.map((component) => component.id));
  const unknownRemovalId = input.removeComponentIds.find((id) => !existingComponentIds.has(id));
  if (unknownRemovalId) {
    throw new Error(`O componente '${unknownRemovalId}' não existe no dashboard atual.`);
  }
  const removedComponentIds = new Set(input.removeComponentIds);
  const survivingComponents = existingComponents.filter((component) => !removedComponentIds.has(component.id));
  const proposedIds = new Set(proposedComponents.map((component) => component.id));
  const suppliesCompleteOrder = survivingComponents.every((component) => proposedIds.has(component.id));
  const nextComponents = suppliesCompleteOrder
    ? proposedComponents
    : mergeBy(survivingComponents, proposedComponents, (component) => component.id);
  const removedQueryIds = new Set(
    existingComponents
      .filter((component) => removedComponentIds.has(component.id))
      .flatMap((component) => {
        const queryUuid = component.props.queryUuid;
        return typeof queryUuid === "string" ? [queryUuid] : [];
      }),
  );
  const stillReferencedQueryIds = new Set([
    ...nextComponents.flatMap((component) => {
      const queryUuid = component.props.queryUuid;
      return typeof queryUuid === "string" ? [queryUuid] : [];
    }),
    ...workspaceParams.flatMap((parameter) =>
      parameter.lookup ? [parameter.lookup.queryUuid] : [],
    ),
  ]);
  const queryBindings = mergedQueryBindings.filter(
    (binding) =>
      !removedQueryIds.has(binding.queryUuid) ||
      stillReferencedQueryIds.has(binding.queryUuid),
  );
  const document = dashboardDocumentSchema.parse({
    id: dashboardId,
    name: input.name ?? previous?.name ?? "",
    description: input.description ?? previous?.description ?? "",
    workspace: { params: workspaceParams },
    queryBindings,
    ui: {
      layout: { type: "grid", columns: 12, gap: input.gap ?? previous?.ui.layout.gap ?? 16 },
      components: nextComponents,
    },
  });
  if (input.mode === "update" && previous && document.id !== previous.id) {
    throw new Error("O id do dashboard não pode ser alterado.");
  }
  return document;
}

export function dashboardProposalPreviewScope(
  document: DashboardDocument,
  componentIds: string[],
): {
  componentIds: string[];
  componentQueryIds: Set<string>;
  queryIds: Set<string>;
  arguments: DashboardDocument["workspace"]["params"];
} {
  const requestedIds = new Set(componentIds);
  const components = document.ui.components.filter((component) =>
    requestedIds.has(component.id),
  );
  if (
    requestedIds.size !== componentIds.length ||
    components.length !== requestedIds.size
  ) {
    throw new Error("A prévia precisa apontar para os componentes desta proposta.");
  }

  const componentQueryIds = new Set(
    components.flatMap((component) => {
      const queryUuid = component.props.queryUuid;
      return typeof queryUuid === "string" ? [queryUuid] : [];
    }),
  );
  const argumentNames = new Set(
    document.queryBindings
      .filter((binding) => componentQueryIds.has(binding.queryUuid))
      .flatMap((binding) =>
        Object.values(binding.parameters).flatMap((source) =>
          source.source === "context" ? [source.argument] : [],
        ),
      ),
  );
  const argumentsInScope = document.workspace.params.filter((argument) =>
    argumentNames.has(argument.name),
  );
  const queryIds = new Set(componentQueryIds);
  argumentsInScope.forEach((argument) => {
    if (argument.lookup) queryIds.add(argument.lookup.queryUuid);
  });

  return {
    componentIds: components.map((component) => component.id),
    componentQueryIds,
    queryIds,
    arguments: argumentsInScope,
  };
}

export function dashboardDocumentFingerprint(document: DashboardDocument): string {
  return createHash("sha256").update(stableJson(document)).digest("hex");
}

export function dashboardReferenceFingerprint(
  references: Array<{
    queryId: string;
    queryUpdatedAt: Date;
    dataSourceId: string;
    sourceUpdatedAt: Date;
    sourceTargetHash: string;
  }>,
): string {
  const canonical = [...references]
    .sort((left, right) => left.queryId.localeCompare(right.queryId, "en-US"))
    .map((reference) => ({
      ...reference,
      queryUpdatedAt: reference.queryUpdatedAt.toISOString(),
      sourceUpdatedAt: reference.sourceUpdatedAt.toISOString(),
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function makeDashboardProposalReceiptId(): string {
  return randomUUID();
}

export const DASHBOARD_PROPOSAL_TTL_MS = 5 * 60 * 1_000;
