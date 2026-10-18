import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CurrentViewRefreshProvider } from "@/shared/context/CurrentViewRefreshContext";
import { dataSourcesApi } from "@/modules/data-sources/api/data-sources.api";
import { identityApi } from "@/modules/identity/api/identity.api";
import { queriesApi } from "@/modules/queries/api/queries.api";
import { ImperativeUIProvider } from "@/shared/context/ImperativeUIContext";
import { AdminSectionPage } from "./AdminPage";

vi.mock("@/modules/identity/hooks/AuthContext", () => ({ useAuth: () => ({ user: { isAdmin: true } }) }));
vi.mock("@/modules/identity/api/identity.api", () => {
  const list = () => vi.fn(() => Promise.resolve([]));
  return { identityApi: { users: list(), permissions: list() } };
});
vi.mock("@/modules/data-sources/api/data-sources.api", () => {
  const list = () => vi.fn(() => Promise.resolve([]));
  return { dataSourcesApi: { dataSources: list() } };
});
vi.mock("@/modules/queries/api/queries.api", () => {
  const list = () => vi.fn(() => Promise.resolve([]));
  return { queriesApi: { queries: list() } };
});

const calls = () =>
  Object.entries({ ...identityApi, ...dataSourcesApi, ...queriesApi } as unknown as Record<string, ReturnType<typeof vi.fn>>)
    .filter(([, fn]) => fn.mock.calls.length > 0)
    .map(([name]) => name)
    .sort();

describe("seções do admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it.each([
    ["users", ["permissions", "users"]], // permissões alimentam o sheet
    ["permissions", ["permissions"]],
    ["sources", ["dataSources"]],
    ["queries", ["dataSources", "queries"]], // fontes alimentam o formulário
  ] as const)("%s carrega só a própria lista", async (section, expected) => {
    render(
      <ImperativeUIProvider>
        <CurrentViewRefreshProvider>
          <AdminSectionPage section={section} />
        </CurrentViewRefreshProvider>
      </ImperativeUIProvider>,
    );
    await waitFor(() => expect(calls()).toEqual(expected));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls()).toEqual(expected);
  });
});

afterEach(cleanup);
