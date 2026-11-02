import { expect, it } from "vite-plus/test";

import { sessionNativeMenuListener } from "./sessionNativeMenu";

it("delivers a native menu broadcast once to the selected pane, then back to the single view", () => {
  let selected = 3;
  let tiled = true;
  const received: Array<{ pane: number; action: string }> = [];
  const listeners = [-1, 0, 1, 2, 3, 4, 5, 6, 7].map((pane) =>
    sessionNativeMenuListener((action) => received.push({ pane, action }), {
      frameElement:
        pane === -1
          ? null
          : {
              getAttribute: (name) =>
                name === "name" ? "t3-session-pane" : String(pane === selected),
            },
      document: { querySelector: () => (pane === -1 && tiled ? ({} as Element) : null) },
    }),
  );
  for (const listener of listeners) listener("open-settings");
  expect(received).toEqual([{ pane: 3, action: "open-settings" }]);
  selected = 6;
  received.length = 0;
  for (const listener of listeners) listener("sidebar.toggle");
  expect(received).toEqual([{ pane: 6, action: "sidebar.toggle" }]);
  tiled = false;
  received.length = 0;
  listeners[0]!("open-settings");
  expect(received).toEqual([{ pane: -1, action: "open-settings" }]);
});
