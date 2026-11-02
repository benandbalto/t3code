import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { makeThreadFixture } from "../test-fixtures";
import {
  sessionWorkspaceId,
  sessionWorkspacePanes,
  sessionWorkspacePage,
  restoreSessionWorkspaces,
  sessionWorkspaceFrameUrl,
} from "./sessionWorkspace.logic";

const serverA = EnvironmentId.make("vm-a");
const serverB = EnvironmentId.make("vm-b");
const project = ProjectId.make("same-project-id");
const now = "2026-11-01T12:00:00.000Z";

it("opens the requested session in desktop hash history and web browser history", () => {
  const route = "/vm-a/thread%3Aone?view=chat#latest";
  expect(sessionWorkspaceFrameUrl(route, true)).toBe(`/#${route}`);
  expect(sessionWorkspaceFrameUrl(route, false)).toBe(route);
  expect(sessionWorkspaceFrameUrl("/", true)).toBe("/#/");
});

function thread(id: string, overrides: Parameters<typeof makeThreadFixture>[0] = {}) {
  return makeThreadFixture({
    id: ThreadId.make(id),
    environmentId: serverA,
    projectId: project,
    ...overrides,
  });
}

describe("sessionWorkspacePanes", () => {
  it("isolates equal project and thread ids on different remote servers", () => {
    const threads = [
      thread("same"),
      thread("same", { environmentId: serverB }),
      thread("other-project", { projectId: ProjectId.make("other") }),
    ];
    const projectScope = { kind: "project", environmentId: serverA, projectId: project } as const;
    const serverScope = { kind: "server", environmentId: serverB } as const;
    expect(
      sessionWorkspacePanes(threads, projectScope, false, now).map((pane) => pane.url),
    ).toEqual(["/vm-a/same"]);
    expect(sessionWorkspacePanes(threads, serverScope, false, now).map((pane) => pane.url)).toEqual(
      ["/vm-b/same"],
    );
    expect(sessionWorkspaceId(projectScope)).not.toBe(
      sessionWorkspaceId({ ...projectScope, environmentId: serverB }),
    );
  });

  it("includes waiting and idle sessions while excluding parked history and embedded children", () => {
    const threads = [
      thread("idle"),
      thread("waiting", { hasPendingUserInput: true }),
      thread("settled", { settledOverride: "settled", settledAt: now }),
      thread("auto-settled", { settledAt: now }),
      thread("active-override", { settledOverride: "active", settledAt: now }),
      thread("snoozed", { snoozedUntil: "2026-11-02T12:00:00.000Z" }),
      thread("woken", { snoozedUntil: "2026-11-02T12:00:00.000Z", hasPendingApprovals: true }),
      thread("archived", { archivedAt: now }),
      thread("deleted", { deletedAt: now }),
      thread("child", {
        lineage: {
          parentThreadId: ThreadId.make("idle"),
          rootThreadId: ThreadId.make("idle"),
          relationshipToParent: "subagent",
        },
      }),
      thread("side-chat", {
        lineage: {
          parentThreadId: ThreadId.make("idle"),
          rootThreadId: ThreadId.make("idle"),
          relationshipToParent: null,
          sideChat: true,
        },
      }),
    ];
    const scope = { kind: "server", environmentId: serverA } as const;
    expect(
      sessionWorkspacePanes(threads, scope, false, now).map(
        (pane) => pane.title === "Thread" && pane.url,
      ),
    ).toEqual(["/vm-a/active-override", "/vm-a/idle", "/vm-a/waiting", "/vm-a/woken"]);
    expect(sessionWorkspacePanes(threads, scope, true, now).map((pane) => pane.url)).toEqual([
      "/vm-a/active-override",
      "/vm-a/auto-settled",
      "/vm-a/idle",
      "/vm-a/settled",
      "/vm-a/snoozed",
      "/vm-a/waiting",
      "/vm-a/woken",
    ]);
  });

  it("keeps creation order when recent activity changes and encodes route ids", () => {
    const older = thread("thread:one/two", {
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: now,
    });
    const newer = thread("newer", { createdAt: "2026-10-02T00:00:00.000Z" });
    const scope = { kind: "server", environmentId: serverA } as const;
    const before = sessionWorkspacePanes([newer, older], scope, false, now);
    const after = sessionWorkspacePanes([{ ...newer, updatedAt: now }, older], scope, false, now);
    expect(before.map((pane) => pane.url)).toEqual(["/vm-a/thread%3Aone%2Ftwo", "/vm-a/newer"]);
    expect(after).toEqual(before);
  });
});

describe("sessionWorkspacePage", () => {
  it("reaches every session beyond eight and clamps the page after removals", () => {
    const panes = sessionWorkspacePanes(
      Array.from({ length: 19 }, (_, index) => thread(String(index).padStart(2, "0"))),
      { kind: "server", environmentId: serverA },
      false,
      now,
    );
    const pages = [0, 1, 2].map((page) => sessionWorkspacePage({ panes, page }));
    expect(pages.map((page) => page.panes.length)).toEqual([8, 8, 3]);
    expect(pages.flatMap((page) => page.panes)).toEqual(panes);
    expect(sessionWorkspacePage({ panes: panes.slice(0, 8), page: 2 })).toEqual({
      page: 0,
      pages: 1,
      panes: panes.slice(0, 8),
    });
    expect(sessionWorkspacePage({ panes: [], page: 2 })).toEqual({ page: 0, pages: 1, panes: [] });
  });
});

describe("restoreSessionWorkspaces", () => {
  it("restores remote scopes, slot order, selection, pages, and hidden workspaces", () => {
    const scope = { kind: "project", environmentId: serverA, projectId: project } as const;
    const panes = sessionWorkspacePanes(
      Array.from({ length: 10 }, (_, index) => thread(String(index))),
      scope,
      true,
      now,
    );
    const workspace = {
      id: sessionWorkspaceId(scope),
      label: "VM A",
      scope,
      panes: panes.toReversed(),
      activeId: panes[0]!.id,
      page: 1,
      includeSettled: true,
      revision: 4,
    };
    const saved = { version: 1, workspaces: [workspace], selectedId: workspace.id, zoomed: true };
    expect(restoreSessionWorkspaces(JSON.stringify(saved))).toEqual({
      workspaces: [{ ...workspace, revision: 0 }],
      selectedId: workspace.id,
      zoomed: true,
    });
    expect(restoreSessionWorkspaces(JSON.stringify({ ...saved, selectedId: null }))).toEqual({
      workspaces: [{ ...workspace, revision: 0 }],
      selectedId: null,
      zoomed: false,
    });
  });

  it("recovers from corrupt storage and rejects unsafe or duplicate pane URLs", () => {
    for (const raw of [null, "{", "{}", '{"version":2}']) {
      expect(restoreSessionWorkspaces(raw)).toEqual({
        workspaces: [],
        selectedId: null,
        zoomed: false,
      });
    }
    const workspace = {
      id: "manual",
      label: "Manual",
      scope: null,
      panes: [
        { id: "valid", url: "/vm-a/thread?view=chat#latest" },
        { id: "valid", url: "/duplicate" },
        ...[
          "https://evil.example/",
          "//evil.example/",
          "/\\evil.example/",
          "javascript:alert(1)",
        ].map((url) => ({ id: url, url })),
      ],
      activeId: "removed",
      page: 100,
      includeSettled: false,
    };
    const restored = restoreSessionWorkspaces(
      JSON.stringify({
        version: 1,
        workspaces: [workspace, workspace],
        selectedId: "missing",
        zoomed: true,
      }),
    );
    expect(restored).toEqual({
      workspaces: [
        { ...workspace, panes: [workspace.panes[0]], activeId: null, page: 0, revision: 0 },
      ],
      selectedId: null,
      zoomed: false,
    });
  });
});
