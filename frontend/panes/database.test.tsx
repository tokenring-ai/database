import { beforeEach, describe, expect, it, mock } from "bun:test";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defineView } from "@tokenring-ai/one-frontend/layout/define.ts";
import { createLayoutRegistry } from "@tokenring-ai/one-frontend/layout/registry.ts";
import { renderLayoutApp } from "@tokenring-ai/one-frontend/test/layout.tsx";
import { MessageSquare } from "lucide-react";
import type React from "react";
import { SWRConfig } from "swr";

// focus-trap refuses to activate in jsdom.
const PassThroughFocusTrap = ({ children }: { children: React.ReactNode }) => children;
void mock.module("focus-trap-react", () => ({ FocusTrap: PassThroughFocusTrap, default: PassThroughFocusTrap }));

type Query = Record<string, unknown>;

const state = {
  datasources: [
    { name: "primary", scheme: "mysql", allowWrites: true, status: "ready" },
    { name: "reports", scheme: "mysql", allowWrites: false, status: "ready" },
  ] as Array<{ name: string; scheme: string; allowWrites: boolean; status: "ready" | "missingSecret" }>,
  agentTypes: ["database"],
  tables: [
    { name: "users", schema: "app", type: "table" as const },
    { name: "user_stats", schema: "app", type: "view" as const },
  ] as Array<{ name: string; schema?: string; type: "table" | "view" }>,
  columns: [
    { name: "id", dataType: "int", nullable: false, isPrimaryKey: true },
    { name: "email", dataType: "varchar", nullable: true, isPrimaryKey: false },
  ],
  rows: [
    { id: 1, email: "ada@example.com" },
    { id: 2, email: "grace@example.com" },
  ],
  rowsError: undefined as unknown,
  agents: [] as Array<Record<string, unknown>>,
};

/** Row queries the table view issued, newest last. */
const rowQueries: Query[] = [];

const updateDatabaseState = mock(async (_args: Record<string, unknown>) => ({ status: "success" as const }));
const applyConfig = mock(async (_args: Record<string, unknown>) => ({ ok: true as const }));
const getConfigValues = mock(
  async (): Promise<{ overrides: { workspace: Record<string, unknown>; global: Record<string, unknown> } }> => ({
    overrides: { workspace: {}, global: {} },
  }),
);
const testConnection = mock(
  async (_args: Record<string, unknown>): Promise<{ ok: boolean; tableCount?: number; error?: string }> => ({ ok: true, tableCount: 2 }),
);
const createAgent = mock(async (_args: Record<string, unknown>) => ({ id: "agent-new", displayName: "Database Agent", description: "" }));
type ExecuteSqlResponse =
  | {
      status: "success";
      rows: Record<string, unknown>[];
      fields: string[];
      rowCount: number;
      truncated: boolean;
      affectedRows: number | null;
      elapsedMs: number;
      readOnly: boolean;
    }
  | { status: "confirmationRequired"; message: string }
  | { status: "writeRefused"; message: string }
  | { status: "error"; error: string; elapsedMs: number };
const executeSqlSuccess: ExecuteSqlResponse = {
  status: "success",
  rows: [
    { id: 1, email: "ada@example.com" },
    { id: 2, email: "grace@example.com" },
  ],
  fields: ["id", "email"],
  rowCount: 2,
  truncated: false,
  affectedRows: 2,
  elapsedMs: 12,
  readOnly: true,
};
const executeSql = mock(async (_args: Record<string, unknown>): Promise<ExecuteSqlResponse> => executeSqlSuccess);
const mutateRow = mock(
  async (_args: Record<string, unknown>): Promise<{ status: "success"; affectedRows: number | null } | { status: "error"; error: string }> => ({
    status: "success",
    affectedRows: 1,
  }),
);
const ddlState = { schema: { users: "CREATE TABLE users (id INT PRIMARY KEY)", orders: "CREATE TABLE orders (id INT)" } as Record<string, string> };

// Monaco does not run under jsdom; a textarea stands in for the shared editor.
void mock.module("@tokenring-ai/one-frontend/components/editor/CodeEditor.tsx", () => ({
  default: ({ content, onContentChange }: { file: string; content: string; onContentChange?: (value: string) => void }) => (
    <textarea aria-label="SQL editor" defaultValue={content} onChange={event => onContentChange?.(event.target.value)} />
  ),
}));
const mutateConfiguration = mock(async (): Promise<void> => {});
const mutateTables = mock(async (): Promise<void> => {});

void mock.module("@tokenring-ai/one-frontend/rpc.ts", () => ({
  useDatabaseConfiguration: () => ({
    data: { datasources: state.datasources, agentTypes: state.agentTypes },
    isLoading: false,
    error: undefined,
    mutate: mutateConfiguration,
  }),
  useDatabaseTables: (datasource: string | undefined) => ({
    data: datasource ? { tables: state.tables } : undefined,
    isLoading: false,
    error: undefined,
    mutate: mutateTables,
  }),
  useTableSchema: (datasource: string | undefined, table: string | undefined) => ({
    data: datasource && table ? { schema: { columns: state.columns, primaryKey: ["id"] } } : undefined,
    isLoading: false,
    error: undefined,
    mutate: mock(async () => undefined),
  }),
  useTableRows: (datasource: string | undefined, table: string | undefined, query: Query) => {
    if (datasource && table) rowQueries.push(query);
    return {
      data: datasource && table && !state.rowsError ? { rows: state.rows, fields: ["id", "email"], totalCount: state.rows.length, hasMore: false } : undefined,
      isLoading: false,
      error: state.rowsError,
      mutate: mock(async () => undefined),
    };
  },
  useTypedSWR: (key: string | null) => ({
    data: typeof key === "string" && key.startsWith("/database/showSchema/") ? { schema: ddlState.schema } : undefined,
    isLoading: false,
    error: undefined,
    mutate: mock(async () => undefined),
  }),
  databaseRPCClient: { updateDatabaseState, testConnection, executeSql, mutateRow },
  configRPCClient: { getConfigValues, applyConfig },
  agentRPCClient: { createAgent, deleteAgent: mock(async () => ({ status: "success" as const })) },
  useAgentList: () => ({ data: state.agents, isLoading: false, error: undefined, mutate: mock(async () => undefined) }),
  useAgentTypes: () => ({ data: [{ type: "database", displayName: "Database Agent", description: "", enabledTools: [] }], isLoading: false }),
}));

const { DATABASE_APP } = await import("../layout.ts");
const { default: databaseViews } = await import("../views.tsx");
const { databaseTableInstanceKey } = await import("../lib/instanceKeys.ts");
const { resetDatabaseStore } = await import("../lib/databaseStore.ts");

function ChatStub() {
  return <p>chat stub</p>;
}

const chatView = defineView({
  id: "chat",
  kind: "agent",
  title: params => params.agentId ?? "Chat",
  icon: MessageSquare,
  route: "agent/:agentId",
  instanceKey: params => params.agentId ?? "",
  component: ChatStub,
});

const registry = createLayoutRegistry({
  apps: [DATABASE_APP],
  views: [...databaseViews.views, chatView],
  kinds: [
    { id: "navigator", label: "Navigators", plural: "navigators" },
    { id: "agent", label: "Agents", plural: "agent chats" },
    { id: "database", label: "Database views", plural: "database views" },
  ],
});

function Fresh({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

const renderApp = (url = "/database") => renderLayoutApp({ registry, url, wrapper: Fresh });
const tab = (name: string | RegExp) => screen.queryByRole("tab", { name });

function resetState() {
  localStorage.clear();
  resetDatabaseStore();
  rowQueries.length = 0;
  for (const fn of [updateDatabaseState, applyConfig, getConfigValues, createAgent, mutateConfiguration, mutateTables, testConnection, executeSql, mutateRow])
    fn.mockClear();
  executeSql.mockImplementation(async () => executeSqlSuccess);
  mutateRow.mockImplementation(async () => ({ status: "success", affectedRows: 1 }));
  testConnection.mockImplementation(async () => ({ ok: true, tableCount: 2 }));
  getConfigValues.mockImplementation(async () => ({ overrides: { workspace: {}, global: {} } }));
  state.rowsError = undefined;
  state.agents = [];
  state.datasources = [
    { name: "primary", scheme: "mysql", allowWrites: true, status: "ready" },
    { name: "reports", scheme: "mysql", allowWrites: false, status: "ready" },
  ];
  state.tables = [
    { name: "users", schema: "app", type: "table" },
    { name: "user_stats", schema: "app", type: "view" },
  ];
}

async function openQuery(user: ReturnType<typeof userEvent.setup>, datasource: string) {
  renderApp();
  await user.click(await screen.findByRole("button", { name: `Query ${datasource}` }));
  await screen.findByRole("textbox", { name: "SQL editor" });
}

describe("Database app", () => {
  beforeEach(resetState);

  describe("routes", () => {
    it("resolves every old URL shape", () => {
      expect(registry.routes.resolve("/database")).toMatchObject({ app: "database", viewId: "database-start" });
      expect(registry.routes.resolve("/database/primary")).toMatchObject({ viewId: "database-start", params: { datasource: "primary" } });
      expect(registry.routes.resolve("/database/primary/users")).toMatchObject({ viewId: "database-table", params: { datasource: "primary", table: "users" } });
      expect(registry.routes.resolve("/database/primary/-/query")).toMatchObject({ viewId: "database-query", params: { datasource: "primary" } });
      expect(registry.routes.resolve("/database/primary/-/schema")).toMatchObject({ viewId: "database-schema", params: { datasource: "primary" } });
      expect(registry.routes.resolve("/database/primary/-/schema/users")).toMatchObject({
        viewId: "database-schema",
        params: { datasource: "primary", table: "users" },
      });
      expect(registry.routes.urlFor("database", "database-table", { datasource: "a/b", table: "c" })).toBe("/database/a%2Fb/c");
    });

    it("keys table panels unambiguously when names contain a slash", () => {
      expect(databaseTableInstanceKey({ datasource: "a/b", table: "c" })).not.toBe(databaseTableInstanceKey({ datasource: "a", table: "b/c" }));
      expect(databaseTableInstanceKey({ datasource: "primary", table: "users" })).toBe("primary/users");
    });
  });

  describe("datasource tree", () => {
    it("lists datasources and expands the first one until the URL names another", async () => {
      renderApp();

      expect(await screen.findByText("primary")).toBeInTheDocument();
      expect(screen.getByText("reports")).toBeInTheDocument();
      expect(screen.getByText("users")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open datasource primary" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "Open datasource reports" })).toHaveAttribute("aria-expanded", "false");
      expect(screen.getAllByText("Select a table").length).toBeGreaterThan(0);
    });

    it("opens a table tab, navigates, and closes the landing tab", async () => {
      const user = userEvent.setup();
      const app = renderApp();
      expect(tab("Select a table")).toBeInTheDocument();

      await user.click(await screen.findByText("users"));

      expect(app.location().pathname).toBe("/database/primary/users");
      await waitFor(() => expect(tab(/users/)).toBeInTheDocument());
      expect(tab("Select a table")).not.toBeInTheDocument();
    });

    it("selecting a datasource only navigates; no table tab is opened", async () => {
      const user = userEvent.setup();
      const app = renderApp();

      await user.click(await screen.findByRole("button", { name: "Open datasource reports" }));

      expect(app.location().pathname).toBe("/database/reports");
      expect(screen.getByRole("button", { name: "Open datasource reports" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText(/under "reports"/)).toBeInTheDocument();
    });

    it("highlights the datasource and table named by the URL", async () => {
      renderApp("/database/reports/users");

      expect(await screen.findByRole("button", { name: "Open datasource reports" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "users" })).toHaveAttribute("aria-current", "true");
    });

    it("adds a datasource through the form and opens it", async () => {
      const user = userEvent.setup();
      const app = renderApp();

      await user.click(await screen.findByRole("button", { name: "Add datasource" }));
      await user.type(screen.getByLabelText("Name"), "analytics");
      await user.type(screen.getByLabelText("Connection String"), "mysql://user:pw@host:3306/db");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(applyConfig).toHaveBeenCalledTimes(1));
      const overrides = applyConfig.mock.calls[0]![0]!.overrides as { database: { datasources: Record<string, unknown> } };
      expect(Object.keys(overrides.database.datasources)).toEqual(["analytics"]);
      await waitFor(() => expect(app.location().pathname).toBe("/database/analytics"));
    });

    it("tests a new connection string before saving and saves nothing when it fails", async () => {
      const user = userEvent.setup();
      testConnection.mockImplementation(async () => ({ ok: false, error: "connection refused" }));
      const app = renderApp();

      await user.click(await screen.findByRole("button", { name: "Add datasource" }));
      expect(screen.getByText(/PostgreSQL/)).toBeInTheDocument();
      await user.type(screen.getByLabelText("Name"), "analytics");
      await user.type(screen.getByLabelText("Connection String"), "postgres://host/db");
      await user.click(screen.getByRole("button", { name: "Test & save" }));

      expect(await screen.findByText(/connection refused — not saved/)).toBeInTheDocument();
      expect(testConnection).toHaveBeenCalledWith({ datasource: "analytics", url: "postgres://host/db" });
      expect(applyConfig).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      testConnection.mockImplementation(async () => ({ ok: true, tableCount: 3 }));
      await user.click(screen.getByRole("button", { name: "Test & save" }));
      await waitFor(() => expect(applyConfig).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(app.location().pathname).toBe("/database/analytics"));
    });

    it("closes the datasource form on Escape", async () => {
      const user = userEvent.setup();
      renderApp();

      await user.click(await screen.findByRole("button", { name: "Add datasource" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("lists a datasource whose secret is unset with a badge and a fix action", async () => {
      const user = userEvent.setup();
      state.datasources = [{ name: "pending", scheme: "unknown", allowWrites: false, status: "missingSecret" }];
      renderApp();

      expect(await screen.findByText("No connection string")).toBeInTheDocument();
      expect(screen.getByTestId("datasource-missing-secret")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Set connection string →" }));
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("explains the empty state and links to Configuration", async () => {
      state.datasources = [];
      renderApp();

      expect(await screen.findByText(/browse its tables/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Configuration" }).getAttribute("href")).toBe("/configuration");
    });

    it("deletes a datasource from the layer that defines it after confirmation", async () => {
      const user = userEvent.setup();
      getConfigValues.mockImplementation(async () => ({
        overrides: { workspace: { database: { datasources: { primary: { url: "x", allowWrites: true }, reports: { url: "y" } } } }, global: {} },
      }));
      renderApp();

      await user.click(await screen.findByRole("button", { name: "Edit primary" }));
      const del = screen.getByRole("button", { name: /Delete/ });
      await waitFor(() => expect(del).toBeEnabled());
      await user.click(del);
      expect(applyConfig).not.toHaveBeenCalled();
      const confirm = await screen.findByRole("dialog", { name: "Delete datasource?" });
      await user.click(within(confirm).getByRole("button", { name: "Delete" }));

      await waitFor(() => expect(applyConfig).toHaveBeenCalledTimes(1));
      const call = applyConfig.mock.calls[0]![0]! as { scope: string; overrides: { database: { datasources: Record<string, unknown> } } };
      expect(call.scope).toBe("workspace");
      expect(Object.keys(call.overrides.database.datasources)).toEqual(["reports"]);
    });

    it("lists agent sessions and opens a chat for the attached one", async () => {
      state.agents = [{ id: "agent-1", createdAt: 1, agentType: "database", displayName: "Database Agent", description: "", idle: true, currentActivity: "" }];
      renderApp();

      expect(await screen.findByText("Database agents")).toBeInTheDocument();
      await waitFor(() => expect(tab(/agent-1/)).toBeInTheDocument());
      // With no table open the navigator points the agent at the browsed datasource.
      // Omitting table is what clears activeTable on the agent.
      await waitFor(() => expect(updateDatabaseState).toHaveBeenCalledWith({ agentId: "agent-1", datasource: "primary", selectedRows: [] }));
    });

    it("opens a postgres table by schema and name, quoting a dot inside the name", async () => {
      const user = userEvent.setup();
      state.datasources = [{ name: "primary", scheme: "postgres", allowWrites: true, status: "ready" }];
      state.tables = [
        { name: "users", schema: "public", type: "table" },
        { name: "users", schema: "analytics", type: "table" },
        { name: "odd.name", schema: "analytics", type: "table" },
      ];
      const app = renderApp();

      await user.click(await screen.findByRole("button", { name: "analytics.users" }));
      expect(app.location().pathname).toBe("/database/primary/analytics.users");
      expect(screen.getByRole("button", { name: "public.users" })).not.toHaveAttribute("aria-current", "true");

      await user.click(screen.getByRole("button", { name: "analytics.odd.name" }));
      const dotted = 'analytics."odd.name"';
      expect(app.location().pathname).toBe(`/database/primary/${encodeURIComponent(dotted)}`);

      await user.click(screen.getByRole("button", { name: "Columns of analytics.odd.name" }));
      await waitFor(() => expect(tab(/odd\.name"? columns/)).toBeInTheDocument());
    });

    it("highlights only the postgres table whose schema and name are in the URL", async () => {
      state.datasources = [{ name: "primary", scheme: "postgresql", allowWrites: true, status: "ready" }];
      state.tables = [
        { name: "users", schema: "public", type: "table" },
        { name: "users", schema: "analytics", type: "table" },
        { name: "odd.name", schema: "analytics", type: "table" },
      ];
      const dotted = 'analytics."odd.name"';
      renderApp(`/database/primary/${encodeURIComponent(dotted)}`);

      expect(await screen.findByRole("button", { name: "analytics.odd.name" })).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("button", { name: "analytics.users" })).not.toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("button", { name: "public.users" })).not.toHaveAttribute("aria-current", "true");
    });

    it("opens the query editor and table columns from the tree", async () => {
      const user = userEvent.setup();
      const app = renderApp();

      await user.click(await screen.findByRole("button", { name: "Query primary" }));
      await waitFor(() => expect(tab("Query · primary")).toBeInTheDocument());
      expect(app.location().pathname).toBe("/database/primary/-/query");
      await user.click(screen.getByRole("button", { name: "Columns of users" }));
      await waitFor(() => expect(tab("users columns")).toBeInTheDocument());
      expect(app.location().pathname).toBe("/database/primary/-/schema/users");
    });
  });
  describe("table view", () => {
    it("renders rows for its table and opens the row detail pane", async () => {
      const user = userEvent.setup();
      renderApp("/database/primary/users");

      expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
      await waitFor(() => expect(tab("users")).toBeInTheDocument());
      // Read-only badge only for datasources that disallow writes.
      expect(screen.queryByText("Read-only")).not.toBeInTheDocument();

      await user.dblClick(screen.getByText("grace@example.com"));
      const detail = await screen.findByRole("complementary", { name: "Row detail" });
      expect(within(detail).getByText("grace@example.com")).toBeInTheDocument();

      await user.click(within(detail).getByRole("button", { name: "Close row detail" }));
      expect(screen.queryByRole("complementary", { name: "Row detail" })).not.toBeInTheDocument();
    });

    it("opens the row detail from the keyboard through the per-row details button", async () => {
      const user = userEvent.setup();
      renderApp("/database/primary/users");

      expect(await screen.findByTestId("row-detail-hint")).toBeInTheDocument();
      const buttons = screen.getAllByRole("button", { name: "Row details" });
      expect(buttons).toHaveLength(2);
      buttons[1]!.focus();
      await user.keyboard("{Enter}");
      const detail = await screen.findByRole("complementary", { name: "Row detail" });
      expect(within(detail).getByText("grace@example.com")).toBeInTheDocument();
    });

    it("marks read-only datasources", async () => {
      renderApp("/database/reports/users");
      expect(await screen.findByText("Read-only")).toBeInTheDocument();
    });

    it("sends filters to the row query", async () => {
      const user = userEvent.setup();
      renderApp("/database/primary/users");

      await user.click(await screen.findByRole("button", { name: /Filter/ }));
      await user.selectOptions(screen.getByLabelText("Filter column"), "email");
      await user.type(screen.getByLabelText("Filter value"), "ada@example.com");

      await waitFor(() => {
        const latest = rowQueries.at(-1)!;
        expect(latest.filters).toEqual([{ column: "email", op: "eq", value: "ada@example.com" }]);
      });
    });

    it("selecting rows offers an agent launch and syncs the selection to the attached agent", async () => {
      const user = userEvent.setup();
      state.agents = [{ id: "agent-1", createdAt: 1, agentType: "database", displayName: "Database Agent", description: "", idle: true, currentActivity: "" }];
      renderApp("/database/primary/users");

      await user.click(await screen.findByRole("checkbox", { name: "Select row 1" }));

      expect(screen.getByTestId("agent-launch-panel")).toBeInTheDocument();
      await waitFor(() =>
        expect(updateDatabaseState).toHaveBeenCalledWith({
          agentId: "agent-1",
          datasource: "primary",
          table: "users",
          selectedRows: [state.rows[0]],
        }),
      );
    });

    it("shows a retryable error when the rows fail to load", async () => {
      state.rowsError = new Error("connection refused");
      renderApp("/database/primary/users");

      expect(await screen.findByText("Failed to load rows")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    });
  });

  describe("query and schema views", () => {
    async function typeSql(user: ReturnType<typeof userEvent.setup>, sql: string) {
      const editor = await screen.findByRole("textbox", { name: "SQL editor" });
      await user.clear(editor);
      await user.type(editor, sql);
      return editor;
    }

    it("runs a read and shows rows, row count and elapsed time", async () => {
      const user = userEvent.setup();
      await openQuery(user, "primary");

      await typeSql(user, "SELECT * FROM users");
      await user.click(screen.getByRole("button", { name: "Run" }));

      expect(executeSql).toHaveBeenCalledWith({ datasource: "primary", sql: "SELECT * FROM users" });
      expect(await screen.findByText("grace@example.com")).toBeInTheDocument();
      const summary = screen.getByTestId("query-summary");
      expect(summary).toHaveTextContent("2 rows");
      expect(summary).toHaveTextContent("12 ms");
      // No confirmation for a read.
      expect(screen.queryByRole("button", { name: "Run statement" })).toBeNull();
    });

    it("runs on Ctrl+Enter from the editor", async () => {
      const user = userEvent.setup();
      await openQuery(user, "primary");

      const editor = await typeSql(user, "SELECT 1");
      editor.focus();
      await user.keyboard("{Control>}{Enter}{/Control}");

      await waitFor(() => expect(executeSql).toHaveBeenCalledTimes(1));
      expect(executeSql).toHaveBeenCalledWith({ datasource: "primary", sql: "SELECT 1" });
    });

    it("asks before a statement that can modify data and sends the confirmation", async () => {
      const user = userEvent.setup();
      executeSql.mockImplementation(async () => ({ ...executeSqlSuccess, rows: [], fields: [], rowCount: 0, affectedRows: 1, readOnly: false }));
      await openQuery(user, "primary");

      await typeSql(user, "DELETE FROM users WHERE id = 1");
      await user.click(screen.getByRole("button", { name: "Run" }));
      expect(await screen.findByText(/This statement can modify data/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(executeSql).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Run" }));
      await user.click(await screen.findByRole("button", { name: "Run statement" }));
      await waitFor(() => expect(executeSql).toHaveBeenCalledWith({ datasource: "primary", sql: "DELETE FROM users WHERE id = 1", confirmWrite: true }));
      expect(await screen.findByText("Statement executed")).toBeInTheDocument();
      expect(screen.getByText(/1 row affected/)).toBeInTheDocument();
    });

    it("shows the server's refusal for a write on a read-only datasource without asking", async () => {
      const user = userEvent.setup();
      executeSql.mockImplementation(async () => ({ status: "writeRefused", message: "The datasource 'reports' is read-only" }));
      await openQuery(user, "reports");

      await typeSql(user, "DROP TABLE users");
      await user.click(screen.getByRole("button", { name: "Run" }));

      expect(await screen.findByTestId("query-write-refused")).toHaveTextContent("read-only");
      expect(executeSql).toHaveBeenCalledWith({ datasource: "reports", sql: "DROP TABLE users" });
    });

    it("shows SQL errors and records the run in the history", async () => {
      const user = userEvent.setup();
      executeSql.mockImplementation(async () => ({ status: "error", error: "no such table: nope", elapsedMs: 3 }));
      await openQuery(user, "primary");

      await typeSql(user, "SELECT * FROM nope");
      await user.click(screen.getByRole("button", { name: "Run" }));

      expect(await screen.findByText("Query failed")).toBeInTheDocument();
      expect(screen.getAllByText(/no such table: nope/).length).toBeGreaterThan(0);

      await user.click(screen.getByRole("button", { name: "Show query history" }));
      const entries = screen.getAllByTestId("query-history-entry");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toHaveTextContent("SELECT * FROM nope");
    });

    it("re-runs a statement from the history", async () => {
      const user = userEvent.setup();
      await openQuery(user, "primary");

      await typeSql(user, "SELECT 1");
      await user.click(screen.getByRole("button", { name: "Run" }));
      await waitFor(() => expect(executeSql).toHaveBeenCalledTimes(1));
      await typeSql(user, "SELECT 2");

      await user.click(screen.getByRole("button", { name: "Show query history" }));
      await user.click(within(screen.getByTestId("query-history-entry")).getByRole("button", { name: "Run again" }));

      await waitFor(() => expect(executeSql).toHaveBeenCalledTimes(2));
      expect(executeSql).toHaveBeenLastCalledWith({ datasource: "primary", sql: "SELECT 1" });
      expect(await screen.findByRole("textbox", { name: "SQL editor" })).toHaveValue("SELECT 1");
    });

    it("lists a table's columns with its primary key", async () => {
      const user = userEvent.setup();
      renderApp("/database/primary/users");
      await user.click((await screen.findAllByRole("button", { name: "Columns of users" }))[0]!);

      const rows = await screen.findAllByTestId("schema-column");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent("id");
      expect(within(rows[0]!).getByLabelText("Primary key")).toBeInTheDocument();
      expect(within(rows[1]!).queryByLabelText("Primary key")).toBeNull();
      expect(screen.getByText("Primary key:")).toBeInTheDocument();
    });

    it("shows a datasource's DDL and links each table to its columns", async () => {
      const user = userEvent.setup();
      renderApp();
      await user.click(await screen.findByRole("button", { name: "Schema of primary" }));

      expect(await screen.findAllByTestId("schema-table")).toHaveLength(2);
      expect(screen.getByText("CREATE TABLE users (id INT PRIMARY KEY)")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Columns of orders" }));
      await waitFor(() => expect(tab("orders columns")).toBeInTheDocument());
    });
  });
});

describe("Database row editing", () => {
  beforeEach(resetState);

  const openTable = (datasource = "primary") => renderApp(`/database/${datasource}/users`);

  it("updates only the changed fields of a row, keyed by its primary key", async () => {
    const user = userEvent.setup();
    openTable();

    await user.click((await screen.findAllByRole("button", { name: "Row details" }))[0]!);
    await user.click(screen.getByRole("button", { name: "Edit row" }));
    const email = screen.getByRole("textbox", { name: "email" });
    await user.clear(email);
    await user.type(email, "ada@lovelace.dev");
    await user.click(screen.getByRole("button", { name: "Save row" }));

    await waitFor(() =>
      expect(mutateRow).toHaveBeenCalledWith({ datasource: "primary", table: "users", kind: "update", key: { id: 1 }, values: { email: "ada@lovelace.dev" } }),
    );
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Edit row" })).toBeNull());
  });

  it("reports a row that no longer matches its key", async () => {
    const user = userEvent.setup();
    mutateRow.mockImplementation(async () => ({ status: "success", affectedRows: 0 }));
    openTable();

    await user.click((await screen.findAllByRole("button", { name: "Row details" }))[0]!);
    await user.click(screen.getByRole("button", { name: "Edit row" }));
    await user.type(screen.getByRole("textbox", { name: "email" }), "x");
    await user.click(screen.getByRole("button", { name: "Save row" }));

    expect(await screen.findByText(/No row matched/)).toBeInTheDocument();
  });

  it("inserts a row with typed values coerced to the column type", async () => {
    const user = userEvent.setup();
    openTable();

    await user.click(await screen.findByRole("button", { name: /Add row/ }));
    await user.type(screen.getByRole("textbox", { name: "id" }), "3");
    await user.type(screen.getByRole("textbox", { name: "email" }), "new@example.com");
    await user.click(screen.getByRole("button", { name: "Insert row" }));

    await waitFor(() =>
      expect(mutateRow).toHaveBeenCalledWith({ datasource: "primary", table: "users", kind: "insert", values: { id: 3, email: "new@example.com" } }),
    );
  });

  it("refuses a non-numeric value for a numeric column", async () => {
    const user = userEvent.setup();
    openTable();

    await user.click(await screen.findByRole("button", { name: /Add row/ }));
    await user.type(screen.getByRole("textbox", { name: "id" }), "abc");
    await user.click(screen.getByRole("button", { name: "Insert row" }));

    expect(await screen.findByText("Not a number.")).toBeInTheDocument();
    expect(mutateRow).not.toHaveBeenCalled();
  });

  it("deletes a row after confirmation", async () => {
    const user = userEvent.setup();
    openTable();

    await user.click((await screen.findAllByRole("button", { name: "Row details" }))[1]!);
    await user.click(screen.getByRole("button", { name: "Delete row" }));
    expect(await screen.findByText(/This cannot be undone/)).toBeInTheDocument();
    const dialogButtons = screen.getAllByRole("button", { name: "Delete row" });
    await user.click(dialogButtons[dialogButtons.length - 1]!);

    await waitFor(() => expect(mutateRow).toHaveBeenCalledWith({ datasource: "primary", table: "users", kind: "delete", key: { id: 2 } }));
  });

  it("offers no editing on a read-only datasource", async () => {
    const user = userEvent.setup();
    openTable("reports");

    await user.click((await screen.findAllByRole("button", { name: "Row details" }))[0]!);
    expect(screen.queryByRole("button", { name: "Edit row" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete row" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add row/ })).toBeNull();
  });
});
