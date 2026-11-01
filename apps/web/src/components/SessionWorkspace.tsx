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
import { Columns2Icon, Maximize2Icon, Minimize2Icon, PlusIcon, XIcon } from "lucide-react";

import { Button } from "./ui/button";
import { cn, randomUUID } from "../lib/utils";
import { useThreadRouteRef } from "../hooks/useThreadRouteTarget";
import { useQuietThreadShell } from "../state/entities";

const PaneLauncherContext = createContext<(() => void) | null>(null);
const PANE_NAME = "t3-session-pane";
const MAX_PANES = 8;

type Pane = { id: string; url: string; title?: string };
type PaneCommand = "next" | "previous" | "add" | "zoom" | "close";

export function isSessionPane() {
  return window.name === PANE_NAME && window.parent !== window;
}

export function TileSessionsButton() {
  const open = use(PaneLauncherContext);
  return open ? (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Tile chat sessions"
      title="Tile chat sessions (Ctrl+Alt+Enter)"
      onClick={open}
    >
      <Columns2Icon />
    </Button>
  ) : null;
}

function paneShortcut(event: KeyboardEvent): PaneCommand | null {
  if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey || event.isComposing)
    return null;
  switch (event.code || event.key) {
    case "ArrowRight":
      return "next";
    case "ArrowLeft":
      return "previous";
    case "Enter":
      return "add";
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
  const [panes, setPanes] = useState<Pane[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const embedded = isSessionPane();

  function focusPane(id: string) {
    setActiveId(id);
    frames.current.get(id)?.contentWindow?.focus();
  }

  function addPane() {
    if (panes.length >= MAX_PANES) return;
    const pane = { id: randomUUID(), url: "/" };
    setPanes([...panes, pane]);
    setActiveId(pane.id);
    setZoomed(false);
  }

  function closePane(id: string) {
    const remaining = panes.filter((pane) => pane.id !== id);
    setPanes(remaining);
    if (id === activeId) setActiveId(remaining[0]?.id ?? null);
    if (remaining.length < 2) setZoomed(false);
  }

  function runCommand(command: PaneCommand, sourceId = activeId) {
    if (command === "add") return addPane();
    if (command === "zoom") return setZoomed(!zoomed);
    if (command === "close" && sourceId) return closePane(sourceId);
    const index = panes.findIndex((pane) => pane.id === sourceId);
    const next = panes[(index + (command === "previous" ? panes.length - 1 : 1)) % panes.length];
    if (next) focusPane(next.id);
  }

  function open() {
    const first = {
      id: randomUUID(),
      url: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    };
    setPanes([first, { id: randomUUID(), url: "/" }]);
    setActiveId(first.id);
  }

  const onMessage = useEffectEvent((event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const pane = panes.find(
      (candidate) => frames.current.get(candidate.id)?.contentWindow === event.source,
    );
    if (!pane || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "t3-session-focus") setActiveId(pane.id);
    if (event.data.type === "t3-session-location" && typeof event.data.url === "string") {
      if (!event.data.url.startsWith("/") || event.data.url.startsWith("//")) return;
      const url = new URL(event.data.url, window.location.origin);
      if (url.origin !== window.location.origin) return;
      const path = `${url.pathname}${url.search}${url.hash}`;
      const title =
        typeof event.data.title === "string" ? event.data.title.slice(0, 256) : undefined;
      setPanes((current) =>
        current.map((item) => (item.id === pane.id ? { ...item, url: path, title } : item)),
      );
    }
    if (
      event.data.type === "t3-session-command" &&
      ["next", "previous", "add", "zoom", "close"].includes(event.data.command)
    ) {
      setActiveId(pane.id);
      runCommand(event.data.command, pane.id);
    }
  });
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const command = paneShortcut(event);
    if (!command) return;
    if (panes.length === 0 && command !== "add") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (panes.length === 0) open();
    else runCommand(command);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for navigation, focus, and shortcuts from independent pane windows
  useEffect(() => {
    if (embedded) return;
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [embedded]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves browser focus after the active pane changes
  useEffect(() => {
    if (activeId) frames.current.get(activeId)?.contentWindow?.focus();
  }, [activeId]);

  if (embedded)
    return (
      <>
        <SessionPaneBridge />
        {children}
      </>
    );
  if (panes.length === 0) return <PaneLauncherContext value={open}>{children}</PaneLauncherContext>;

  return (
    <div className="flex h-dvh min-w-0 flex-1 flex-col bg-background text-foreground">
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
        role="toolbar"
        aria-label="Session layout"
      >
        <Columns2Icon className="size-4" />
        <span className="mr-auto text-sm font-medium">
          Sessions{" "}
          <span className="text-muted-foreground">
            {panes.length}/{MAX_PANES}
          </span>
        </span>
        <Button
          size="compact"
          variant="outline"
          disabled={panes.length >= MAX_PANES}
          onClick={addPane}
        >
          <PlusIcon />
          Add session
        </Button>
        <Button
          size="compact"
          variant="ghost"
          onClick={() => {
            setPanes([]);
            setZoomed(false);
          }}
        >
          Exit tiles
        </Button>
      </div>
      <div
        className="grid min-h-0 flex-1 grid-rows-1 gap-1 overflow-hidden p-1"
        style={{
          gridTemplateColumns: `repeat(${zoomed ? 1 : panes.length}, minmax(0, 1fr))`,
        }}
      >
        {panes.map((pane, index) => (
          <section
            key={pane.id}
            aria-label={`Session ${index + 1}`}
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
                Session {index + 1}
              </Button>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {pane.title ?? "Choose a thread from the sidebar"}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={zoomed ? `Restore session ${index + 1}` : `Zoom session ${index + 1}`}
                onClick={() => {
                  setActiveId(pane.id);
                  setZoomed(!zoomed);
                }}
              >
                {zoomed ? <Minimize2Icon /> : <Maximize2Icon />}
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Close session ${index + 1}`}
                onClick={() => closePane(pane.id)}
              >
                <XIcon />
              </Button>
            </div>
            <SessionFrame
              pane={pane}
              index={index}
              register={(frame) => {
                if (frame) frames.current.set(pane.id, frame);
                else frames.current.delete(pane.id);
              }}
            />
          </section>
        ))}
      </div>
      <div className="shrink-0 border-t px-3 py-1 text-xs text-muted-foreground">
        Ctrl+Alt+←/→ switch panes · Ctrl+Alt+Enter add · Ctrl+Alt+Z zoom · Closing a pane keeps its
        thread running.
      </div>
    </div>
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
  const [src] = useState(pane.url);
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
