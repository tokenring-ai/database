import type { ConfigScope } from "@tokenring-ai/app";
import PasswordInput from "@tokenring-ai/one-frontend/components/ui/PasswordInput.tsx";
import { toastManager } from "@tokenring-ai/one-frontend/components/ui/toast.tsx";
import { useConfirmDialog } from "@tokenring-ai/one-frontend/hooks/useConfirmDialog.tsx";
import { formatConfigIssues, SENSITIVE_KEEP, updateConfigLayer } from "@tokenring-ai/one-frontend/lib/configWrites.ts";
import { configRPCClient, databaseRPCClient } from "@tokenring-ai/one-frontend/rpc.ts";
import formatError from "@tokenring-ai/utility/error/formatError";
import { AlertTriangle, CheckCircle2, Database, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CONNECTION_STRING_PLACEHOLDER } from "../constants.ts";
import type { DatasourceSummary } from "../types.ts";

/**
 * Datasource map from either modern `{ datasources: {…} }` or legacy flat
 * `{ mydb: { url, allowWrites } }` database config.
 */
function datasourcesMapFromConfig(database: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!database) return {};
  const nested = database.datasources;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...(nested as Record<string, unknown>) };
  }
  const { agentTypes: _agentTypes, datasources: _datasources, ...legacy } = database;
  return { ...legacy };
}

function configHasDatasource(database: Record<string, unknown> | undefined, name: string): boolean {
  return name in datasourcesMapFromConfig(database);
}

/**
 * Creates or edits one entry under the `database.datasources` config key.
 *
 * Writes go through the shared config layer rather than a database-specific RPC:
 * that persists to disk and live-reconfigures the running plugin in one step,
 * and it already knows how to keep a stored secret when the user doesn't retype
 * the connection string.
 */
export default function DatasourceFormModal({
  existing,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** Present when editing; absent when adding. */
  existing?: DatasourceSummary;
  onClose: () => void;
  onSaved: (name: string) => void;
  /** Called after the edited datasource was removed from its configuration layer. */
  onDeleted?: (name: string) => void;
}) {
  const isEdit = existing !== undefined;
  // A datasource whose secret is unset has nothing stored to keep.
  const hasStoredUrl = isEdit && existing.status !== "missingSecret";
  const [name, setName] = useState(existing?.name ?? "");
  const [url, setUrl] = useState("");
  const [allowWrites, setAllowWrites] = useState(existing?.allowWrites ?? false);
  // Project is the usual place for shared connection strings; user can still choose.
  // When editing, we prefer the scope that already owns this name (project wins if both).
  const [scope, setScope] = useState<ConfigScope>("workspace");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // The override layer that defines the edited datasource: undefined while
  // loading, null when neither does (packaged defaults), which can't be deleted here.
  const [ownerScope, setOwnerScope] = useState<ConfigScope | null | undefined>(undefined);
  const confirmDialog = useConfirmDialog();

  useEffect(() => {
    if (!existing) return;

    const abortController = new AbortController();
    void (async () => {
      const signal = abortController.signal;
      try {
        const values = await configRPCClient.getConfigValues({});
        if (signal.aborted) return;
        const projectDb = values.overrides.workspace.database as Record<string, unknown> | undefined;
        const userDb = values.overrides.global.database as Record<string, unknown> | undefined;
        const owner = configHasDatasource(projectDb, existing.name) ? "workspace" : configHasDatasource(userDb, existing.name) ? "global" : null;
        if (owner) setScope(owner);
        setOwnerScope(owner);
      } catch {
        // Leave the default — the user can still pick a scope manually.
        setOwnerScope(null);
      }
    })();
    return () => abortController.abort();
  }, [existing]);

  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  // On edit an untouched URL means "keep what's stored", so it isn't required.
  const canSave = trimmedName !== "" && (hasStoredUrl || trimmedUrl !== "");

  const writeConfig = async (): Promise<boolean> => {
    const result = await updateConfigLayer(scope, overrides => {
      const previousDatabase = (overrides.database as Record<string, unknown> | undefined) ?? {};
      const datasources = datasourcesMapFromConfig(previousDatabase);
      // A rename is a move, not a copy.
      if (isEdit && existing.name !== trimmedName) delete datasources[existing.name];

      const previous = (datasources[trimmedName] ?? {}) as Record<string, unknown>;
      datasources[trimmedName] = {
        ...previous,
        url: trimmedUrl !== "" ? trimmedUrl : SENSITIVE_KEEP,
        allowWrites,
      };

      // Always persist the modern shape so agentTypes and datasources coexist cleanly.
      const database: Record<string, unknown> = { datasources };
      if (Array.isArray(previousDatabase.agentTypes)) {
        database.agentTypes = previousDatabase.agentTypes;
      }
      return { ...overrides, database };
    });

    if (!result.ok) {
      toastManager.error(formatConfigIssues(result.issues), { duration: 6000 });
      return false;
    }
    return true;
  };

  /**
   * Tests first, saves only on success: a typed connection string is dry-run
   * on the server without being registered; a blank one on edit tests the
   * stored connection. A failed test leaves the configuration untouched.
   */
  const handleTest = async () => {
    if (!canSave) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await databaseRPCClient.testConnection(
        trimmedUrl !== "" ? { datasource: trimmedName, url: trimmedUrl } : { datasource: existing?.name ?? trimmedName },
      );
      if (!result.ok) {
        setTestResult({ ok: false, message: `${result.error ?? "Connection failed"} — not saved.` });
        return;
      }
      if (!(await writeConfig())) return;
      const tables = result.tableCount ?? 0;
      toastManager.success(`Datasource "${trimmedName}" saved — connected, ${tables} table${tables === 1 ? "" : "s"} found`, { duration: 3000 });
      onSaved(trimmedName);
      onClose();
    } catch (err) {
      setTestResult({ ok: false, message: formatError(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || !ownerScope) return;
    const confirmed = await confirmDialog.openConfirm({
      title: "Delete datasource?",
      message: `Remove "${existing.name}" from the ${ownerScope === "workspace" ? "project" : "user"} configuration? The database itself is not touched.`,
      confirmText: "Delete",
      variant: "danger",
      dontAskAgain: false,
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      const result = await updateConfigLayer(ownerScope, overrides => {
        const previousDatabase = (overrides.database as Record<string, unknown> | undefined) ?? {};
        const datasources = datasourcesMapFromConfig(previousDatabase);
        delete datasources[existing.name];
        const database: Record<string, unknown> = { datasources };
        if (Array.isArray(previousDatabase.agentTypes)) database.agentTypes = previousDatabase.agentTypes;
        return { ...overrides, database };
      });
      if (!result.ok) {
        toastManager.error(formatConfigIssues(result.issues), { duration: 6000 });
        return;
      }
      toastManager.success(`Datasource "${existing.name}" deleted`, { duration: 3000 });
      onDeleted?.(existing.name);
      onClose();
    } catch (err) {
      toastManager.error(formatError(err), { duration: 5000 });
    } finally {
      setDeleting(false);
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (!(await writeConfig())) return;
      toastManager.success(isEdit ? `Datasource "${trimmedName}" updated` : `Datasource "${trimmedName}" added`, { duration: 3000 });
      onSaved(trimmedName);
      onClose();
    } catch (err) {
      toastManager.error(formatError(err), { duration: 5000 });
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || testing || deleting;

  // Escape closes, unless a request is in flight or the delete confirmation is on top.
  const confirmOpen = confirmDialog.isOpen;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy || confirmOpen || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, confirmOpen, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="datasource-form-title"
        className="w-full max-w-lg bg-secondary border border-primary rounded-2xl shadow-card overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-primary">
          <div className="flex items-center gap-2.5 min-w-0">
            <Database className="w-4 h-4 text-cyan-400 shrink-0" />
            <h2 id="datasource-form-title" className="text-base font-semibold text-primary truncate">
              {isEdit ? `Edit ${existing.name}` : "Add datasource"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1.5 text-muted hover:text-primary rounded-lg hover:bg-hover transition-colors focus-ring cursor-pointer disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label htmlFor="datasource-name" className="text-xs font-semibold text-muted uppercase tracking-wider block mb-1">
              Name
            </label>
            <input
              id="datasource-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="production"
              autoComplete="off"
              className="w-full bg-input border border-primary rounded-lg px-3 py-2 text-sm text-primary placeholder-muted focus-accent"
            />
            <p className="text-xs text-muted mt-1">How you and the agent refer to this database.</p>
          </div>

          <div>
            <label htmlFor="datasource-url" className="text-xs font-semibold text-muted uppercase tracking-wider block mb-1">
              Connection String
            </label>
            <PasswordInput
              id="datasource-url"
              value={url}
              onChange={setUrl}
              placeholder={hasStoredUrl ? "•••••••• (leave blank to keep current)" : CONNECTION_STRING_PLACEHOLDER}
              autoComplete="off"
              spellCheck={false}
              inputClassName="py-2 text-sm"
            />
            <p className="text-xs text-muted mt-1">
              {hasStoredUrl
                ? "Stored securely on the server and never sent back to the browser. Leave blank to keep the current one."
                : "Stored securely on the server. Supports MySQL/MariaDB (mysql://), PostgreSQL (postgres://) and SQLite (sqlite:///path/to/file.db)."}
            </p>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={allowWrites}
              onChange={e => setAllowWrites(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-primary bg-input accent-accent cursor-pointer"
            />
            <span className="min-w-0">
              <span className="text-sm text-primary block">Allow writes</span>
              <span className="text-xs text-muted block">
                When off, agents can only read from this datasource — write statements are refused outright rather than prompted for.
              </span>
            </span>
          </label>

          <div>
            <label htmlFor="datasource-scope" className="text-xs font-semibold text-muted uppercase tracking-wider block mb-1">
              Save to
            </label>
            <select
              id="datasource-scope"
              value={scope}
              onChange={e => setScope(e.target.value as ConfigScope)}
              className="w-full bg-input border border-primary rounded-lg px-3 py-2 text-sm text-primary focus-accent cursor-pointer"
            >
              <option value="workspace">Project configuration — everyone on this project</option>
              <option value="global">User configuration — only you</option>
            </select>
          </div>

          {testResult && (
            <div
              className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
                testResult.ok ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
              }`}
            >
              {testResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />}
              <span className="min-w-0 break-words">{testResult.message}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-primary">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave || busy}
            className="flex items-center gap-2 px-4 py-2 btn-accent text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 focus-ring shadow-button-primary"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…
              </>
            ) : (
              "Save"
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={!canSave || busy}
            className="flex items-center gap-2 px-4 py-2 border border-primary text-primary hover:bg-hover text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 focus-ring"
          >
            {testing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing…
              </>
            ) : (
              "Test & save"
            )}
          </button>
          {isEdit && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busy || !ownerScope}
              title={ownerScope === null ? "Defined outside the project and user configuration; remove it where it is defined" : `Delete ${existing.name}`}
              className="flex items-center gap-1.5 px-3 py-2 text-red-400 hover:bg-red-500/10 text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50 focus-ring"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="ml-auto px-4 py-2 text-muted hover:text-primary text-sm font-medium rounded-lg hover:bg-hover transition-colors cursor-pointer disabled:opacity-50 focus-ring"
          >
            Cancel
          </button>
        </div>
      </div>
      <confirmDialog.Dialog />
    </div>
  );
}
