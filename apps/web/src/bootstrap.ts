import { showBootError } from "./lib/bootError";

// Electron preloads only the main frame; same-origin session panes use its native bridge.
if (window.name === "t3-session-pane" && window.parent !== window) {
  try {
    if (window.parent.location.origin === window.location.origin && window.parent.desktopBridge) {
      window.desktopBridge = window.parent.desktopBridge;
    }
  } catch {
    // A cross-origin parent cannot supply the desktop bridge.
  }
}

// Shared dev chunks need the React refresh preamble first. Catch failures before React mounts.
void import("./main").then(({ startup }) => startup).catch(showBootError);
