import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";

vi.mock(import("../state/entities"), () => ({
  useProjects: () => [],
  useQuietThreadShell: () => null,
  useQuietThreadShells: () => [],
}));
vi.mock(import("../state/environments"), () => ({
  useEnvironments: () => ({
    isReady: true,
    networkStatus: "online",
    environments: [],
    presentationById: new Map(),
  }),
  usePrimaryEnvironmentId: () => null,
}));
vi.mock(import("../hooks/useThreadRouteTarget"), () => ({
  useThreadRouteRef: () => null,
}));

import { SessionWorkspace } from "./SessionWorkspace";
import { SESSION_WORKSPACES_STORAGE_KEY } from "./sessionWorkspace.logic";

it("keeps background workspace frames alive and routes their navigation to their owning tab", async () => {
  using storage = new DisposableStack();
  const previous = localStorage.getItem(SESSION_WORKSPACES_STORAGE_KEY);
  storage.defer(() => {
    if (previous === null) localStorage.removeItem(SESSION_WORKSPACES_STORAGE_KEY);
    else localStorage.setItem(SESSION_WORKSPACES_STORAGE_KEY, previous);
  });
  localStorage.setItem(
    SESSION_WORKSPACES_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      selectedId: "server",
      zoomed: false,
      workspaces: ["server", "project"].map((id) => ({
        id,
        label: id,
        scope: null,
        panes: [{ id: "shared-session", url: "/workspace-test-frame", title: id }],
        activeId: "shared-session",
        page: 0,
        includeSettled: false,
      })),
    }),
  );
  await using screen = await render(
    <SessionWorkspace>
      <div>Normal view</div>
    </SessionWorkspace>,
  );
  const frames = () => [...screen.container.querySelectorAll("iframe")];
  expect(frames()).toHaveLength(2);
  const [serverFrame, projectFrame] = frames();
  const serverWindow = serverFrame!.contentWindow;
  expect(serverFrame!.dataset.sessionActive).toBe("true");
  expect(projectFrame!.dataset.sessionActive).toBe("false");

  await screen.getByRole("tab", { name: "2 · project" }).click();
  expect(frames()).toEqual([serverFrame, projectFrame]);
  expect(serverFrame!.contentWindow).toBe(serverWindow);
  expect(serverFrame!.dataset.sessionActive).toBe("false");
  expect(projectFrame!.dataset.sessionActive).toBe("true");

  await act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        source: serverWindow,
        data: { type: "t3-session-location", url: "/background-navigation", title: "Updated" },
      }),
    );
    for (const data of [
      { type: "t3-session-focus" },
      { type: "t3-session-command", command: "workspace:0" },
    ]) {
      window.dispatchEvent(
        new MessageEvent("message", { origin: window.location.origin, source: serverWindow, data }),
      );
    }
  });
  const saved = JSON.parse(localStorage.getItem(SESSION_WORKSPACES_STORAGE_KEY)!);
  expect(saved.workspaces[0].panes[0].url).toBe("/background-navigation");
  expect(saved.workspaces[1].panes[0].url).toBe("/workspace-test-frame");
  expect(saved.selectedId).toBe("project");

  await screen.getByRole("tab", { name: "1 · server" }).click();
  expect(frames()[0]).toBe(serverFrame);
  expect(serverFrame!.getAttribute("src")).toBe("/workspace-test-frame");
  expect(serverFrame!.dataset.sessionActive).toBe("true");
  await screen.getByRole("button", { name: "Close workspace", exact: true }).click();
  expect(serverFrame!.isConnected).toBe(false);
  expect(frames()).toEqual([projectFrame]);
  expect(projectFrame!.dataset.sessionActive).toBe("true");
});
