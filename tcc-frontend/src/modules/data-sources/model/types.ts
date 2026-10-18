export type DataSource = {
  id: string;
  updatedAt: string;
  contextVersion: number;
  name: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  context: string;
};

export type DataSourceTable = {
  id: string;
  dataSourceId: string;
  schemaName: string;
  tableName: string;
  context: string;
  contextVersion: number;
};
