import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { isListedThreadLineage, EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const MAX_SESSION_PANES = 8;

export function sessionWorkspaceFrameUrl(route: string, isDesktop: boolean) {
  return isDesktop ? `/#${route}` : route;
}

export type SessionWorkspaceScope =
  | { kind: "server"; environmentId: EnvironmentId }
  | { kind: "project"; environmentId: EnvironmentId; projectId: ProjectId };

export type SessionPane = { id: string; url: string; title?: string };

export type SessionWorkspaceState = {
  id: string;
  label: string;
  scope: SessionWorkspaceScope | null;
  panes: SessionPane[];
  activeId: string | null;
  page: number;
  includeSettled: boolean;
  revision: number;
};

export const SESSION_WORKSPACES_STORAGE_KEY = "t3code:session-workspaces:v1";

const PersistedWorkspaces = Schema.Struct({
  version: Schema.Literal(1),
  selectedId: Schema.NullOr(Schema.String),
  zoomed: Schema.Boolean,
  workspaces: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      scope: Schema.NullOr(
        Schema.Union([
          Schema.Struct({ kind: Schema.Literal("server"), environmentId: EnvironmentId }),
          Schema.Struct({
            kind: Schema.Literal("project"),
            environmentId: EnvironmentId,
            projectId: ProjectId,
          }),
        ]),
      ),
      panes: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          url: Schema.String,
          title: Schema.optionalKey(Schema.String),
        }),
      ),
      activeId: Schema.NullOr(Schema.String),
      page: Schema.Number,
      includeSettled: Schema.Boolean,
    }),
  ),
});
const decodeWorkspaces = Schema.decodeUnknownSync(PersistedWorkspaces);

export function restoreSessionWorkspaces(raw: string | null): {
  workspaces: SessionWorkspaceState[];
  selectedId: string | null;
  zoomed: boolean;
} {
  try {
    if (!raw) throw new Error("No saved workspaces");
    const saved = decodeWorkspaces(JSON.parse(raw));
    const ids = new Set<string>();
    const workspaces = saved.workspaces.flatMap((workspace) => {
      if (ids.has(workspace.id)) return [];
      ids.add(workspace.id);
      const paneIds = new Set<string>();
      const panes = workspace.panes.flatMap((pane) => {
        if (paneIds.has(pane.id) || !/^\/(?!\/)[^\\\u0000-\u001f]*$/.test(pane.url)) return [];
        paneIds.add(pane.id);
        return [{ ...pane }];
      });
      return [
        {
          ...workspace,
          panes,
          activeId: panes.some((pane) => pane.id === workspace.activeId)
            ? workspace.activeId
            : null,
          page: sessionWorkspacePage({ panes, page: Math.trunc(workspace.page) }).page,
          revision: 0,
        },
      ];
    });
    const selectedId = workspaces.some((workspace) => workspace.id === saved.selectedId)
      ? saved.selectedId
      : null;
    return { workspaces, selectedId, zoomed: selectedId !== null && saved.zoomed };
  } catch {
    return { workspaces: [], selectedId: null, zoomed: false };
  }
}

export function sessionWorkspaceId(scope: SessionWorkspaceScope) {
  return JSON.stringify(
    scope.kind === "server"
      ? [scope.kind, scope.environmentId]
      : [scope.kind, scope.environmentId, scope.projectId],
  );
}

export function sessionWorkspacePanes(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  scope: SessionWorkspaceScope,
  includeSettled: boolean,
  now: string,
): SessionPane[] {
  return threads
    .filter(
      (thread) =>
        thread.environmentId === scope.environmentId &&
        (scope.kind === "server" || thread.projectId === scope.projectId) &&
        thread.archivedAt === null &&
        thread.deletedAt === null &&
        isListedThreadLineage(thread.lineage) &&
        (includeSettled ||
          (thread.settledOverride !== "settled" &&
            (thread.settledOverride === "active" || thread.settledAt === null) &&
            !effectiveSnoozed(thread, { now }))),
    )
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((thread) => ({
      id: scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
      url: `/${encodeURIComponent(thread.environmentId)}/${encodeURIComponent(thread.id)}`,
      title: thread.title,
    }));
}

export function sessionWorkspacePage(workspace: Pick<SessionWorkspaceState, "panes" | "page">) {
  const pages = Math.max(1, Math.ceil(workspace.panes.length / MAX_SESSION_PANES));
  const page = Math.min(Math.max(0, workspace.page), pages - 1);
  return {
    page,
    pages,
    panes: workspace.panes.slice(page * MAX_SESSION_PANES, (page + 1) * MAX_SESSION_PANES),
  };
}
