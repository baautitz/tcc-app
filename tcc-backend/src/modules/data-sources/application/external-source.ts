import type { ExternalSourcePort } from "../domain/external-source.js";

let port: ExternalSourcePort | undefined;
export function configureExternalSource(p: ExternalSourcePort): void {
  port = p;
}
export function externalSource(): ExternalSourcePort {
  if (!port) throw new Error("ExternalSourcePort não configurada.");
  return port;
}
