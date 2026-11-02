import {
  createContext,
  use,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "@tanstack/react-router";
import * as DateTime from "effect/DateTime";
import { Columns2Icon, Maximize2Icon, Minimize2Icon, PlusIcon, XIcon } from "lucide-react";

import { Button } from "./ui/button";
import { isElectron } from "../env";
import { cn, randomUUID } from "../lib/utils";
import { useThreadRouteRef } from "../hooks/useThreadRouteTarget";
import { useProjects, useQuietThreadShell, useQuietThreadShells } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { resolveThreadRouteRef } from "../threadRoutes";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuShortcut,
  MenuSeparator,
} from "./ui/menu";
import {
  MAX_SESSION_PANES,
  SESSION_WORKSPACES_STORAGE_KEY,
  restoreSessionWorkspaces,
  sessionWorkspaceFrameUrl,
  sessionWorkspaceId,
  sessionWorkspacePanes,
  sessionWorkspacePage,
  type SessionPane as Pane,
  type SessionWorkspaceScope,
  type SessionWorkspaceState,
} from "./sessionWorkspace.logic";

type WorkspaceChoice = { id: string; label: string; scope: SessionWorkspaceScope };
type WorkspaceLauncher = {
  openManual: () => void;
  openCurrent: (kind: "server" | "project") => void;
  openChoice: (choice: WorkspaceChoice) => void;
  choices: WorkspaceChoice[];
};
const PaneLauncherContext = createContext<WorkspaceLauncher | null>(null);
const PANE_NAME = "t3-session-pane";
type PaneCommand =
  | "next"
  | "previous"
  | "add"
  | "zoom"
  | "close"
  | "server"
  | "project"
  | `workspace:${number}`;

export function isSessionPane() {
  return window.name === PANE_NAME && window.parent !== window;
}

export function TileSessionsButton({ compact = true }: { compact?: boolean }) {
  const launcher = use(PaneLauncherContext);
  if (!launcher) return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size={compact ? "icon-sm" : "compact"}
            aria-label="Open session workspace"
            title="Open session workspace"
          />
        }
      >
        <Columns2Icon />
        {compact ? null : "Open workspace"}
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuItem onClick={() => launcher.openCurrent("server")}>
          Current server<MenuShortcut>Ctrl+Alt+S</MenuShortcut>
        </MenuItem>
        <MenuItem onClick={() => launcher.openCurrent("project")}>
          Current project<MenuShortcut>Ctrl+Alt+P</MenuShortcut>
        </MenuItem>
        <MenuSeparator />
        {(["server", "project"] as const).map((kind) => (
          <MenuGroup key={kind}>
            <MenuGroupLabel>{kind === "server" ? "Servers" : "Projects"}</MenuGroupLabel>
            {launcher.choices
              .filter((choice) => choice.scope.kind === kind)
              .map((choice) => (
                <MenuItem key={choice.id} onClick={() => launcher.openChoice(choice)}>
                  {choice.label}
                </MenuItem>
              ))}
          </MenuGroup>
        ))}
        <MenuSeparator />
        <MenuItem onClick={launcher.openManual}>Choose sessions manually</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function paneShortcut(event: KeyboardEvent): PaneCommand | null {
  if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey || event.isComposing)
    return null;
  if (/^Digit[1-8]$/.test(event.code)) return `workspace:${Number(event.code.slice(-1)) - 1}`;
  switch (event.code || event.key) {
    case "ArrowRight":
      return "next";
    case "ArrowLeft":
      return "previous";
    case "Enter":
      return "add";
    case "KeyS":
      return "server";
    case "KeyP":
      return "project";
    case "KeyZ":
    case "z":
    case "Z":
      return "zoom";
    default:
      return null;
  }
}

function SessionPaneBridge() {
  const href = useLocation({ select: (location) => location.href });
  const threadRef = useThreadRouteRef();
  const title = useQuietThreadShell(threadRef)?.title ?? "Choose a thread";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports this frame's navigation to its owning workspace
  useEffect(() => {
    window.parent.postMessage(
      { type: "t3-session-location", url: href, title },
      window.location.origin,
    );
  }, [href, title]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- forwards workspace shortcuts and focus across the iframe boundary
  useEffect(() => {
    const focus = () =>
      window.parent.postMessage({ type: "t3-session-focus" }, window.location.origin);
    const keydown = (event: KeyboardEvent) => {
      const command = paneShortcut(event);
      if (!command) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.parent.postMessage({ type: "t3-session-command", command }, window.location.origin);
    };
    window.addEventListener("pointerdown", focus, true);
    window.addEventListener("focus", focus);
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("pointerdown", focus, true);
      window.removeEventListener("focus", focus);
      window.removeEventListener("keydown", keydown, true);
    };
  }, []);
  return null;
}

export function SessionWorkspace({ children }: { children: ReactNode }) {
  if (isSessionPane())
    return (
      <>
        <SessionPaneBridge />
        {children}
      </>
    );
  return <SessionWorkspaceManager>{children}</SessionWorkspaceManager>;
}

function SessionWorkspaceManager({ children }: { children: ReactNode }) {
  const href = useLocation({ select: (location) => location.href });
  const [restored] = useState(() => {
    try {
      return restoreSessionWorkspaces(window.localStorage.getItem(SESSION_WORKSPACES_STORAGE_KEY));
    } catch {
      return restoreSessionWorkspaces(null);
    }
  });
  const [workspaces, setWorkspaces] = useState(restored.workspaces);
  const [selectedId, setSelectedId] = useState(restored.selectedId);
  const [zoomed, setZoomed] = useState(restored.zoomed);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves workspace layout outside React so it survives app restarts
  useEffect(() => {
    try {
      window.localStorage.setItem(
        SESSION_WORKSPACES_STORAGE_KEY,
        JSON.stringify({ version: 1, workspaces, selectedId, zoomed }),
      );
    } catch {
      // Storage can be unavailable or full; keep this window usable.
    }
  }, [workspaces, selectedId, zoomed]);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const threads = useQuietThreadShells();
  const routeRef = useThreadRouteRef();
  const routeThread = useQuietThreadShell(routeRef);
  const choices: WorkspaceChoice[] = environments.flatMap((environment) => {
    const serverScope = { kind: "server" as const, environmentId: environment.environmentId };
    return [
      { id: sessionWorkspaceId(serverScope), label: environment.label, scope: serverScope },
      ...projects
        .filter(
          (project) =>
            project.environmentId === environment.environmentId && project.archivedAt == null,
        )
        .map((project) => {
          const scope = {
            kind: "project" as const,
            environmentId: project.environmentId,
            projectId: project.id,
          };
          return {
            id: sessionWorkspaceId(scope),
            label: `${project.title} · ${environment.label}`,
            scope,
          };
        }),
    ];
  });
  const workspace = workspaces.find((item) => item.id === selectedId) ?? null;
  const { page, pages, panes } = sessionWorkspacePage(workspace ?? { panes: [], page: 0 });
  const activeId = panes.some((pane) => pane.id === workspace?.activeId)
    ? workspace!.activeId
    : (panes[0]?.id ?? null);

  function updateWorkspace(update: (current: SessionWorkspaceState) => SessionWorkspaceState) {
    setWorkspaces((current) =>
      current.map((item) => (item.id === selectedId ? update(item) : item)),
    );
  }

  function selectWorkspace(id: string) {
    setSelectedId(id);
    setZoomed(false);
  }

  function openChoice(choice: WorkspaceChoice) {
    if (!workspaces.some((item) => item.id === choice.id)) {
      const loaded = sessionWorkspacePanes(
        threads,
        choice.scope,
        false,
        DateTime.formatIso(DateTime.nowUnsafe()),
      );
      setWorkspaces([
        ...workspaces,
        {
          ...choice,
          panes: loaded,
          activeId: loaded[0]?.id ?? null,
          page: 0,
          includeSettled: false,
          revision: 0,
        },
      ]);
    }
    selectWorkspace(choice.id);
  }

  function currentRef(sourceId = activeId) {
    const pane = panes.find((item) => item.id === sourceId);
    if (!pane) return workspace ? null : routeRef;
    const parts = new URL(pane.url, window.location.origin).pathname.split("/");
    return (
      resolveThreadRouteRef({
        environmentId: decodeURIComponent(parts[1] ?? ""),
        threadId: decodeURIComponent(parts[2] ?? ""),
      }) ?? routeRef
    );
  }

  function openCurrent(kind: "server" | "project", sourceId = activeId) {
    const ref = currentRef(sourceId);
    const environmentId =
      ref?.environmentId ?? workspace?.scope?.environmentId ?? primaryEnvironmentId;
    const thread = ref
      ? threads.find((item) => item.environmentId === ref.environmentId && item.id === ref.threadId)
      : routeThread;
    const choice = choices.find(
      (item) =>
        item.scope.kind === kind &&
        item.scope.environmentId === environmentId &&
        (item.scope.kind === "server" || item.scope.projectId === thread?.projectId),
    );
    if (choice) openChoice(choice);
  }

  function focusPane(id: string) {
    updateWorkspace((current) => ({ ...current, activeId: id }));
    frames.current.get(id)?.contentWindow?.focus();
  }

  function addPane() {
    if (!workspace || workspace.panes.length >= MAX_SESSION_PANES) return;
    const pane = { id: randomUUID(), url: "/" };
    updateWorkspace((current) => ({
      ...current,
      panes: [...current.panes, pane],
      activeId: pane.id,
    }));
    setZoomed(false);
  }

  function closePane(id: string) {
    updateWorkspace((current) => ({
      ...current,
      panes: current.panes.filter((pane) => pane.id !== id),
      activeId: current.activeId === id ? null : current.activeId,
    }));
    setZoomed(false);
  }

  function closeWorkspace() {
    const remaining = workspaces.filter((item) => item.id !== selectedId);
    setWorkspaces(remaining);
    selectWorkspace(remaining[0]?.id ?? "");
  }

  function refreshWorkspace(includeSettled: boolean) {
    if (!workspace?.scope) return;
    const loaded = sessionWorkspacePanes(
      threads,
      workspace.scope,
      includeSettled,
      DateTime.formatIso(DateTime.nowUnsafe()),
    );
    updateWorkspace((current) => ({
      ...current,
      panes: loaded,
      page: 0,
      activeId: loaded[0]?.id ?? null,
      includeSettled,
      revision: current.revision + 1,
    }));
    setZoomed(false);
  }

  function changePage(next: number) {
    updateWorkspace((current) => ({ ...current, page: next, activeId: null }));
    setZoomed(false);
  }

  function openManual() {
    const first = {
      id: randomUUID(),
      url: href,
    };
    const id = randomUUID();
    setWorkspaces([
      ...workspaces,
      {
        id,
        label: "Manual sessions",
        scope: null,
        panes: [first, { id: randomUUID(), url: "/" }],
        activeId: first.id,
        page: 0,
        includeSettled: false,
        revision: 0,
      },
    ]);
    selectWorkspace(id);
  }

  function runCommand(command: PaneCommand, sourceId = activeId) {
    if (command === "server" || command === "project") return openCurrent(command, sourceId);
    if (command.startsWith("workspace:")) {
      const next = workspaces[Number(command.split(":")[1])];
      if (next) selectWorkspace(next.id);
      return;
    }
    if (command === "add") return workspace ? addPane() : openManual();
    if (!workspace) return;
    if (command === "zoom") return setZoomed(!zoomed);
    if (command === "close" && sourceId) return closePane(sourceId);
    const index = panes.findIndex((pane) => pane.id === sourceId);
    const next = panes[(index + (command === "previous" ? panes.length - 1 : 1)) % panes.length];
    if (next) focusPane(next.id);
  }

  const launcher: WorkspaceLauncher = { openManual, openCurrent, openChoice, choices };

  const onMessage = useEffectEvent((event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const pane = panes.find(
      (candidate) => frames.current.get(candidate.id)?.contentWindow === event.source,
    );
    if (!pane || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "t3-session-focus")
      updateWorkspace((current) => ({ ...current, activeId: pane.id }));
    if (event.data.type === "t3-session-location" && typeof event.data.url === "string") {
      if (!event.data.url.startsWith("/") || event.data.url.startsWith("//")) return;
      const url = new URL(event.data.url, window.location.origin);
      if (url.origin !== window.location.origin) return;
      const path = `${url.pathname}${url.search}${url.hash}`;
      const title =
        typeof event.data.title === "string" ? event.data.title.slice(0, 256) : undefined;
      updateWorkspace((current) => ({
        ...current,
        panes: current.panes.map((item) =>
          item.id === pane.id ? { ...item, url: path, title } : item,
        ),
      }));
    }
    if (
      event.data.type === "t3-session-command" &&
      (["next", "previous", "add", "zoom", "close", "server", "project"].includes(
        event.data.command,
      ) ||
        (typeof event.data.command === "string" && /^workspace:[0-7]$/.test(event.data.command)))
    ) {
      runCommand(event.data.command, pane.id);
    }
  });
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const command = paneShortcut(event);
    if (!command) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    runCommand(command);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for navigation, focus, and shortcuts from independent pane windows
  useEffect(() => {
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves browser focus after the active pane changes
  useEffect(() => {
    if (selectedId && activeId) frames.current.get(activeId)?.contentWindow?.focus();
  }, [activeId, selectedId]);

  if (!workspace) return <PaneLauncherContext value={launcher}>{children}</PaneLauncherContext>;

  return (
    <PaneLauncherContext value={launcher}>
      <div className="flex h-dvh min-w-0 flex-1 flex-col bg-background text-foreground">
        {isElectron ? (
          <div
            className="drag-region h-[var(--workspace-topbar-height)] shrink-0 border-b"
            aria-hidden="true"
          />
        ) : null}
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
          role="toolbar"
          aria-label="Session layout"
        >
          <TileSessionsButton compact={false} />
          <div
            className="flex min-w-0 flex-1 flex-wrap gap-1"
            role="tablist"
            aria-label="Session workspaces"
          >
            {workspaces.map((item, index) => (
              <Button
                key={item.id}
                role="tab"
                aria-selected={item.id === workspace.id}
                variant={item.id === workspace.id ? "secondary" : "ghost"}
                size="compact"
                title={index < 8 ? `Ctrl+Alt+${index + 1}` : item.label}
                onClick={() => selectWorkspace(item.id)}
              >
                {index < 8 ? `${index + 1} · ` : ""}
                {item.label}
              </Button>
            ))}
          </div>
          {workspace.scope ? (
            <>
              <Button
                size="compact"
                variant="ghost"
                aria-pressed={workspace.includeSettled}
                onClick={() => refreshWorkspace(!workspace.includeSettled)}
              >
                Include settled
              </Button>
              <Button
                size="compact"
                variant="outline"
                onClick={() => refreshWorkspace(workspace.includeSettled)}
              >
                Refresh sessions
              </Button>
            </>
          ) : null}
          <Button
            size="compact"
            variant="outline"
            disabled={workspace.panes.length >= MAX_SESSION_PANES}
            onClick={addPane}
          >
            <PlusIcon />
            Add slot
          </Button>
          <Button size="compact" variant="ghost" onClick={closeWorkspace}>
            Close workspace
          </Button>
          <Button
            size="compact"
            variant="ghost"
            onClick={() => {
              setSelectedId(null);
              setZoomed(false);
            }}
          >
            Exit tiles
          </Button>
        </div>
        {pages > 1 ? (
          <div className="flex shrink-0 items-center justify-center gap-3 border-b py-1">
            <Button
              size="compact"
              variant="ghost"
              disabled={page === 0}
              onClick={() => changePage(page - 1)}
            >
              Previous sessions
            </Button>
            <span className="text-xs text-muted-foreground">
              {page * MAX_SESSION_PANES + 1}–
              {Math.min((page + 1) * MAX_SESSION_PANES, workspace.panes.length)} of{" "}
              {workspace.panes.length} sessions
            </span>
            <Button
              size="compact"
              variant="ghost"
              disabled={page === pages - 1}
              onClick={() => changePage(page + 1)}
            >
              Next sessions
            </Button>
          </div>
        ) : null}
        {panes.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            No sessions loaded. Connect the server, then refresh sessions or enable Include settled.
          </div>
        ) : null}
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-rows-1 gap-1 overflow-hidden p-1",
            panes.length === 0 && "hidden",
          )}
          style={{
            gridTemplateColumns: `repeat(${zoomed ? 1 : Math.max(1, panes.length)}, minmax(0, 1fr))`,
          }}
        >
          {panes.map((pane, index) => (
            <section
              key={`${workspace.id}:${workspace.revision}:${pane.id}`}
              aria-label={`Session ${page * MAX_SESSION_PANES + index + 1}`}
              className={cn(
                "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border",
                pane.id === activeId ? "border-ring" : "border-border",
                zoomed && pane.id !== activeId && "hidden",
              )}
            >
              <div className="flex shrink-0 items-center gap-1 border-b bg-muted/40 px-2 py-1">
                <Button
                  size="compact"
                  variant="ghost"
                  aria-pressed={pane.id === activeId}
                  onClick={() => focusPane(pane.id)}
                >
                  Session {page * MAX_SESSION_PANES + index + 1}
                </Button>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {pane.title ?? "Choose a thread from the sidebar"}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={
                    zoomed
                      ? `Restore session ${page * MAX_SESSION_PANES + index + 1}`
                      : `Zoom session ${page * MAX_SESSION_PANES + index + 1}`
                  }
                  onClick={() => {
                    updateWorkspace((current) => ({ ...current, activeId: pane.id }));
                    setZoomed(!zoomed);
                  }}
                >
                  {zoomed ? <Minimize2Icon /> : <Maximize2Icon />}
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Close session ${page * MAX_SESSION_PANES + index + 1}`}
                  onClick={() => closePane(pane.id)}
                >
                  <XIcon />
                </Button>
              </div>
              <SessionFrame
                pane={pane}
                index={page * MAX_SESSION_PANES + index}
                register={(frame) => {
                  if (frame) frames.current.set(pane.id, frame);
                  else frames.current.delete(pane.id);
                }}
              />
            </section>
          ))}
        </div>
        <div className="shrink-0 border-t px-3 py-1 text-xs text-muted-foreground">
          Ctrl+Alt+S server · Ctrl+Alt+P project · Ctrl+Alt+1–8 workspace · Ctrl+Alt+←/→ pane ·
          Ctrl+Alt+Enter add slot · Ctrl+Alt+Z zoom. Closing a view keeps agents running.
        </div>
      </div>
    </PaneLauncherContext>
  );
}

function SessionFrame({
  pane,
  index,
  register,
}: {
  pane: Pane;
  index: number;
  register: (frame: HTMLIFrameElement | null) => void;
}) {
  // Keep the initial src stable: navigation inside the pane must not reload its app.
  const [src] = useState(() => sessionWorkspaceFrameUrl(pane.url, isElectron));
  return (
    <iframe
      ref={register}
      name={PANE_NAME}
      title={`Chat session ${index + 1}`}
      src={src}
      className="min-h-0 w-full flex-1 border-0"
      allow="clipboard-read; clipboard-write"
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
    />
  );
}
