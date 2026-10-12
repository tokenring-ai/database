import { beforeEach, describe, expect, it, mock } from "bun:test";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DashboardDefinition, ViewDefinition, ViewParams } from "@tokenring-ai/one-frontend/dock/types.ts";
import { createFakeDashboardApi, createFakePanelHandle, type FakeDashboardApi, renderView } from "@tokenring-ai/one-frontend/test/dock.tsx";
import type React from "react";

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
  ],
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

const { default: contribution, databaseTableInstanceKey } = await import("../app.tsx");
const { resetDatabaseStore, setAttachedDatabaseAgent } = await import("../lib/databaseStore.ts");

const viewById = (id: string) => contribution.views.find(view => view.id === id) as ViewDefinition<any>;
const getView = (id: string) => contribution.views.find(view => view.id === id);
const dashboard: DashboardDefinition = contribution.dashboards[0]!;

function fakeApi(dashboardId = "database"): FakeDashboardApi {
  return createFakeDashboardApi({ dashboardId, getView });
}

function renderDatabaseView(viewId: string, params: ViewParams = {}, path = "/database", api = fakeApi()) {
  const panel = createFakePanelHandle({ viewId, dashboardId: api.dashboardId, panelId: `${viewId}:${JSON.stringify(params)}`, params });
  return renderView(viewById(viewId), params, { api, panel, path, routes: ["/database/:datasource?/:table?"] });
}

const pathname = () => screen.getByTestId("pathname").textContent;

describe("Database dashboard views", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDatabaseStore();
    rowQueries.length = 0;
    for (const fn of [updateDatabaseState, applyConfig, getConfigValues, createAgent, mutateConfiguration, mutateTables, testConnection, executeSql])
      fn.mockClear();
    executeSql.mockImplementation(async () => executeSqlSuccess);
    testConnection.mockImplementation(async () => ({ ok: true, tableCount: 2 }));
    getConfigValues.mockImplementation(async () => ({ overrides: { workspace: {}, global: {} } }));
    state.rowsError = undefined;
    state.agents = [];
    state.datasources = [
      { name: "primary", scheme: "mysql", allowWrites: true, status: "ready" },
      { name: "reports", scheme: "mysql", allowWrites: false, status: "ready" },
    ];
  });

  describe("datasource tree", () => {
    it("lists datasources and expands the first one until the URL names another", async () => {
      renderDatabaseView("datasource-tree");

      expect(await screen.findByText("primary")).toBeInTheDocument();
      expect(screen.getByText("reports")).toBeInTheDocument();
      // Tables of the expanded datasource only.
      expect(screen.getByText("users")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open datasource primary" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "Open datasource reports" })).toHaveAttribute("aria-expanded", "false");
    });

    it("opens a table panel in the main area and keeps the URL in step", async () => {
      const user = userEvent.setup();
      const { api } = renderDatabaseView("datasource-tree");

      await user.click(await screen.findByText("users"));

      expect(api.opened).toEqual([expect.objectContaining({ viewId: "database-table", params: { datasource: "primary", table: "users" } })]);
      expect(pathname()).toBe("/database/primary/users");
    });

    it("fills the placeholder panel instead of opening a second table panel", async () => {
      const user = userEvent.setup();
      const api = fakeApi();
      api.panels.push({ panelId: "database-table:new", viewId: "database-table", params: {}, title: "Select a table" });
      renderDatabaseView("datasource-tree", {}, "/database", api);

      await user.click(await screen.findByText("users"));

      expect(api.opened).toHaveLength(0);
      expect(api.panels[0]!.params).toEqual({ datasource: "primary", table: "users" });
    });

    it("selecting a datasource only navigates; no table panel is opened", async () => {
      const user = userEvent.setup();
      const { api } = renderDatabaseView("datasource-tree");

      await user.click(await screen.findByRole("button", { name: "Open datasource reports" }));

      expect(api.opened).toHaveLength(0);
      expect(pathname()).toBe("/database/reports");
    });

    it("highlights the datasource and table named by the URL", async () => {
      renderDatabaseView("datasource-tree", {}, "/database/reports/users");

      expect(await screen.findByRole("button", { name: "Open datasource reports" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "users" })).toHaveAttribute("aria-current", "true");
    });

    it("only navigates, and hides agent sessions, outside the Database dashboard", async () => {
      const user = userEvent.setup();
      const api = fakeApi("home");
      renderDatabaseView("datasource-tree", {}, "/database", api);

      await user.click(await screen.findByText("users"));

      expect(api.opened).toHaveLength(0);
      expect(pathname()).toBe("/database/primary/users");
      expect(screen.queryByText("Database agents")).not.toBeInTheDocument();
    });

    it("adds a datasource through the form and opens it", async () => {
      const user = userEvent.setup();
      renderDatabaseView("datasource-tree");

      await user.click(await screen.findByRole("button", { name: "Add datasource" }));
      await user.type(screen.getByLabelText("Name"), "analytics");
      await user.type(screen.getByLabelText("Connection String"), "mysql://user:pw@host:3306/db");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(applyConfig).toHaveBeenCalledTimes(1));
      const overrides = applyConfig.mock.calls[0]![0]!.overrides as { database: { datasources: Record<string, unknown> } };
      expect(Object.keys(overrides.database.datasources)).toEqual(["analytics"]);
      await waitFor(() => expect(pathname()).toBe("/database/analytics"));
    });

    it("tests a new connection string before saving and saves nothing when it fails", async () => {
      const user = userEvent.setup();
      testConnection.mockImplementation(async () => ({ ok: false, error: "connection refused" }));
      renderDatabaseView("datasource-tree");

      await user.click(await screen.findByRole("button", { name: "Add datasource" }));
      expect(screen.getByText(/PostgreSQL/)).toBeInTheDocument();
      await user.type(screen.getByLabelText("Name"), "analytics");
      await user.type(screen.getByLabelText("Connection String"), "postgres://host/db");
      await user.click(screen.getByRole("button", { name: "Test & save" }));

      expect(await screen.findByText(/connection refused — not saved/)).toBeInTheDocument();
      expect(testConnection).toHaveBeenCalledWith({ datasource: "analytics", url: "postgres://host/db" });
      expect(applyConfig).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      // A passing test saves and closes the modal.
      testConnection.mockImplementation(async () => ({ ok: true, tableCount: 3 }));
      await user.click(screen.getByRole("button", { name: "Test & save" }));
      await waitFor(() => expect(applyConfig).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      await waitFor(() => expect(pathname()).toBe("/database/analytics"));
    });

    it("closes the datasource form on Escape", async () => {
      const user = userEvent.setup();
      renderDatabaseView("datasource-tree");

      await user.click(await screen.findByRole("button", { name: "Add datasource" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("lists a datasource whose secret is unset with a badge and a fix action", async () => {
      const user = userEvent.setup();
      state.datasources = [{ name: "pending", scheme: "unknown", allowWrites: false, status: "missingSecret" }];
      renderDatabaseView("datasource-tree");

      expect(await screen.findByText("No connection string")).toBeInTheDocument();
      expect(screen.getByTestId("datasource-missing-secret")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Set connection string →" }));
      // Nothing stored to keep, so a connection string is required.
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("explains the empty state and links to Configuration", async () => {
      state.datasources = [];
      renderDatabaseView("datasource-tree");

      expect(await screen.findByText(/browse its tables/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Configuration" }).getAttribute("href")).toBe("/configuration");
    });

    it("deletes a datasource from the layer that defines it after confirmation", async () => {
      const user = userEvent.setup();
      getConfigValues.mockImplementation(async () => ({
        overrides: { workspace: { database: { datasources: { primary: { url: "x", allowWrites: true }, reports: { url: "y" } } } }, global: {} },
      }));
      renderDatabaseView("datasource-tree");

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

    it("lists agent sessions on the Database dashboard and docks a chat for the attached one", async () => {
      state.agents = [{ id: "agent-1", createdAt: 1, agentType: "database", displayName: "Database Agent", description: "", idle: true, currentActivity: "" }];
      const { api } = renderDatabaseView("datasource-tree");

      expect(await screen.findByText("Database agents")).toBeInTheDocument();
      await waitFor(() => expect(api.opened.some(open => open.viewId === "chat" && open.params.agentId === "agent-1")).toBe(true));
      // With no table open the navigator points the agent at the browsed datasource.
      await waitFor(() => expect(updateDatabaseState).toHaveBeenCalledWith({ agentId: "agent-1", datasource: "primary", selectedRows: [] }));
    });
  });

  describe("table view", () => {
    it("is a placeholder until it has params", async () => {
      const { panel } = renderDatabaseView("database-table");

      expect(await screen.findByText("Select a table")).toBeInTheDocument();
      expect(panel.title).toBe("Select a table");
    });

    it("renders rows for its table and opens the row detail pane", async () => {
      const user = userEvent.setup();
      const { panel } = renderDatabaseView("database-table", { datasource: "primary", table: "users" }, "/database/primary/users");

      expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
      expect(panel.title).toBe("users");
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
      renderDatabaseView("database-table", { datasource: "primary", table: "users" }, "/database/primary/users");

      expect(await screen.findByTestId("row-detail-hint")).toBeInTheDocument();
      const buttons = screen.getAllByRole("button", { name: "Row details" });
      expect(buttons).toHaveLength(2);
      buttons[1]!.focus();
      await user.keyboard("{Enter}");
      const detail = await screen.findByRole("complementary", { name: "Row detail" });
      expect(within(detail).getByText("grace@example.com")).toBeInTheDocument();
    });

    it("marks read-only datasources", async () => {
      renderDatabaseView("database-table", { datasource: "reports", table: "users" }, "/database/reports/users");
      expect(await screen.findByText("Read-only")).toBeInTheDocument();
    });

    it("sends filters to the row query", async () => {
      const user = userEvent.setup();
      renderDatabaseView("database-table", { datasource: "primary", table: "users" }, "/database/primary/users");

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
      setAttachedDatabaseAgent("agent-1");
      renderDatabaseView("database-table", { datasource: "primary", table: "users" }, "/database/primary/users");

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
      renderDatabaseView("database-table", { datasource: "primary", table: "users" }, "/database/primary/users");

      expect(await screen.findByText("Failed to load rows")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    });
  });

  describe("dashboard definition", () => {
    const match = (pathname: string, params: Record<string, string | undefined>) => ({ pathname, params, searchParams: new URLSearchParams() });

    it("opens the table named by the route and ignores a datasource on its own", () => {
      const api = fakeApi();
      api.panels.push({ panelId: "datasource-tree", viewId: "datasource-tree", params: {}, title: "Datasources" });

      dashboard.onNavigate?.(match("/database/primary", { datasource: "primary" }), api);
      expect(api.opened).toHaveLength(0);

      dashboard.onNavigate?.(match("/database/primary/users", { datasource: "primary", table: "users" }), api);
      expect(api.opened).toEqual([expect.objectContaining({ viewId: "database-table", params: { datasource: "primary", table: "users" } })]);
      expect(api.opened[0]!.options).toMatchObject({ position: "right", referencePanelId: "datasource-tree" });

      // Idempotent: the same route focuses the panel rather than adding another.
      dashboard.onNavigate?.(match("/database/primary/users", { datasource: "primary", table: "users" }), api);
      expect(api.panels.filter(panel => panel.viewId === "database-table")).toHaveLength(1);
    });

    it("keys table panels unambiguously when names contain a slash", () => {
      const key = (datasource: string, table: string) => databaseTableInstanceKey({ datasource, table });
      expect(key("a/b", "c")).not.toBe(key("a", "b/c"));
      expect(key("primary", "users")).toBe("primary/users");
      expect(databaseTableInstanceKey({})).toBe("new");

      const api = fakeApi();
      api.panels.push({ panelId: "datasource-tree", viewId: "datasource-tree", params: {}, title: "Datasources" });
      dashboard.onNavigate?.(match("/database/a%2Fb/c", { datasource: "a/b", table: "c" }), api);
      dashboard.onNavigate?.(match("/database/a/b%2Fc", { datasource: "a", table: "b/c" }), api);
      expect(api.panels.filter(panel => panel.viewId === "database-table").map(panel => panel.params)).toEqual([
        { datasource: "a/b", table: "c" },
        { datasource: "a", table: "b/c" },
      ]);
    });

    it("maps the active panel back to a URL", () => {
      const current = match("/database/primary", { datasource: "primary" });
      const path = (viewId: string, params: ViewParams = {}) => dashboard.pathForActivePanel?.({ panelId: viewId, viewId, params }, current);

      expect(path("database-table", { datasource: "primary", table: "users" })).toBe("/database/primary/users");
      // The empty placeholder keeps the datasource the tree is showing.
      expect(path("database-table")).toBe("/database/primary");
      expect(path("datasource-tree")).toBeNull();
    });

    it("titles the document from the route", () => {
      expect(dashboard.documentTitle?.(match("/database", {}))).toBe("Database");
      expect(dashboard.documentTitle?.(match("/database/primary", { datasource: "primary" }))).toBe("primary · Database");
      expect(dashboard.documentTitle?.(match("/database/primary/users", { datasource: "primary", table: "users" }))).toBe("users · Database");
    });
  });
});

describe("Database query and schema views", () => {
  const match = (pathname: string, params: Record<string, string | undefined>) => ({ pathname, params, searchParams: new URLSearchParams() });

  beforeEach(() => {
    localStorage.clear();
    resetDatabaseStore();
    executeSql.mockClear();
    executeSql.mockImplementation(async () => executeSqlSuccess);
    state.datasources = [
      { name: "primary", scheme: "mysql", allowWrites: true, status: "ready" },
      { name: "reports", scheme: "mysql", allowWrites: false, status: "ready" },
    ];
  });

  async function typeSql(user: ReturnType<typeof userEvent.setup>, sql: string) {
    const editor = await screen.findByRole("textbox", { name: "SQL editor" });
    await user.clear(editor);
    await user.type(editor, sql);
    return editor;
  }

  it("runs a read and shows rows, row count and elapsed time", async () => {
    const user = userEvent.setup();
    renderDatabaseView("database-query", { datasource: "primary" });

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
    renderDatabaseView("database-query", { datasource: "primary" });

    const editor = await typeSql(user, "SELECT 1");
    editor.focus();
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(executeSql).toHaveBeenCalledTimes(1));
    expect(executeSql).toHaveBeenCalledWith({ datasource: "primary", sql: "SELECT 1" });
  });

  it("asks before a statement that can modify data and sends the confirmation", async () => {
    const user = userEvent.setup();
    executeSql.mockImplementation(async () => ({ ...executeSqlSuccess, rows: [], fields: [], rowCount: 0, affectedRows: 1, readOnly: false }));
    renderDatabaseView("database-query", { datasource: "primary" });

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
    renderDatabaseView("database-query", { datasource: "reports" });

    await typeSql(user, "DROP TABLE users");
    await user.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByTestId("query-write-refused")).toHaveTextContent("read-only");
    expect(executeSql).toHaveBeenCalledWith({ datasource: "reports", sql: "DROP TABLE users" });
  });

  it("shows SQL errors and records the run in the history", async () => {
    const user = userEvent.setup();
    executeSql.mockImplementation(async () => ({ status: "error", error: "no such table: nope", elapsedMs: 3 }));
    renderDatabaseView("database-query", { datasource: "primary" });

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
    renderDatabaseView("database-query", { datasource: "primary" });

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
    renderDatabaseView("database-schema", { datasource: "primary", table: "users" });

    const rows = await screen.findAllByTestId("schema-column");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("id");
    expect(within(rows[0]!).getByLabelText("Primary key")).toBeInTheDocument();
    expect(within(rows[1]!).queryByLabelText("Primary key")).toBeNull();
    expect(screen.getByText("Primary key:")).toBeInTheDocument();
  });

  it("shows a datasource's DDL and links each table to its columns", async () => {
    const user = userEvent.setup();
    const { api } = renderDatabaseView("database-schema", { datasource: "primary" });

    expect(await screen.findAllByTestId("schema-table")).toHaveLength(2);
    expect(screen.getByText("CREATE TABLE users (id INT PRIMARY KEY)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Columns of orders" }));
    expect(api.opened).toEqual([expect.objectContaining({ viewId: "database-schema", params: { datasource: "primary", table: "orders" } })]);
  });

  it("opens the query editor and table columns from the tree", async () => {
    const user = userEvent.setup();
    const { api } = renderDatabaseView("datasource-tree");

    await user.click(await screen.findByRole("button", { name: "Query primary" }));
    await user.click(screen.getByRole("button", { name: "Columns of users" }));

    expect(api.opened.map(entry => [entry.viewId, entry.params])).toEqual([
      ["database-query", { datasource: "primary" }],
      ["database-schema", { datasource: "primary", table: "users" }],
    ]);
  });

  it("points the URL at the datasource of an active query or schema panel", () => {
    const current = match("/database/primary/users", { datasource: "primary", table: "users" });
    const path = (viewId: string, params: ViewParams) => dashboard.pathForActivePanel?.({ panelId: viewId, viewId, params }, current);
    expect(path("database-query", { datasource: "reports" })).toBe("/database/reports");
    expect(path("database-schema", { datasource: "reports", table: "orders" })).toBe("/database/reports");
  });
});

describe("Database row editing", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDatabaseStore();
    mutateRow.mockClear();
    mutateRow.mockImplementation(async () => ({ status: "success", affectedRows: 1 }));
    state.rowsError = undefined;
    state.datasources = [
      { name: "primary", scheme: "mysql", allowWrites: true, status: "ready" },
      { name: "reports", scheme: "mysql", allowWrites: false, status: "ready" },
    ];
  });

  const openTable = (datasource = "primary") => renderDatabaseView("database-table", { datasource, table: "users" }, `/database/${datasource}/users`);

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
