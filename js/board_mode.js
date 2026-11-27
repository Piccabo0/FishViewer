"use strict";

if (new URLSearchParams(window.location.search).get("board") === "secondary") {
  document.body.classList.add("secondary-board");
  const magtailPanel = document.querySelector(".magtail-panel");
  magtailPanel.inert = false;
  magtailPanel.removeAttribute("aria-hidden");
  for (const selector of [".visualization-panel", ".page-navigation", ".secondary-board-frame"]) {
    const element = document.querySelector(selector);
    element.inert = true;
    element.setAttribute("aria-hidden", "true");
  }
} else {
  const secondaryBoard = document.querySelector("#secondaryBoard");
  let secondaryConnectionState = null;
  let secondaryConnectionActions = null;
  secondaryBoard.addEventListener("load", () => {
    const boardDocument = secondaryBoard.contentDocument;
    if (!boardDocument) return;
    const header = document.querySelector(".topbar");
    const connectionState = boardDocument.querySelector(".topbar > .connection-state");
    const connectionActions = boardDocument.querySelector(".topbar > .connection-actions");
    if (!connectionState || !connectionActions) return;
    secondaryConnectionState?.remove();
    secondaryConnectionActions?.remove();
    connectionState.classList.add("secondary-board-controls");
    connectionActions.classList.add("secondary-board-controls");
    header.append(connectionState, connectionActions);
    secondaryConnectionState = connectionState;
    secondaryConnectionActions = connectionActions;
  });
  document.addEventListener("click", (event) => {
    if (secondaryConnectionActions && !secondaryConnectionActions.contains(event.target)) {
      secondaryBoard.contentWindow?.setPortMenuOpen?.(false);
      secondaryBoard.contentWindow?.setBaudMenuOpen?.(false);
    }
  });
  secondaryBoard.src = "index.html?board=secondary";
}
