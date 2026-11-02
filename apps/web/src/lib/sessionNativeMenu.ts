type MenuScope = {
  frameElement: Pick<Element, "getAttribute"> | null;
  document: { querySelector: (selector: string) => Element | null };
};

export function sessionNativeMenuListener(
  listener: (action: string) => void,
  scope: MenuScope = window,
) {
  return (action: string) => {
    if (scope.frameElement?.getAttribute("name") === "t3-session-pane") {
      if (scope.frameElement.getAttribute("data-session-active") !== "true") return;
    } else if (scope.document.querySelector('iframe[name="t3-session-pane"]')) return;
    listener(action);
  };
}
