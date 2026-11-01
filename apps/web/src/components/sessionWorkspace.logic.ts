import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { isListedThreadLineage, type EnvironmentId, type ProjectId } from "@t3tools/contracts";

export const MAX_SESSION_PANES = 8;

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
