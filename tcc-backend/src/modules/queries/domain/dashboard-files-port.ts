export interface DashboardFileView {
  dashboard: {
    name: string;
    workspace: { params: Array<{ label: string; lookup?: { queryUuid: string } | null }> };
    queryBindings: Array<{ queryUuid: string }>;
    ui: { components: Array<{ props: { queryUuid?: unknown } & Record<string, unknown> }> };
  };
  filePath: string;
}

/** Porta para os arquivos de dashboard; implementada em dashboards/infrastructure. */
export interface DashboardFilesPort {
  getFiles(): Promise<DashboardFileView[]>;
  writeAtomically(filePath: string, value: unknown): Promise<() => Promise<void>>;
  withCompensation<T>(operation: () => Promise<T>, getRollback: () => (() => Promise<void>) | undefined): Promise<T>;
  asCompensationFailure(error: unknown): { operationError: unknown; compensationError: unknown } | undefined;
}
