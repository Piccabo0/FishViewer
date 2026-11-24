"use strict";

if (new URLSearchParams(window.location.search).get("board") === "secondary") {
  document.body.classList.add("secondary-board");
  for (const selector of [".visualization-panel", ".page-navigation", ".secondary-board-frame"]) {
    const element = document.querySelector(selector);
    element.inert = true;
    element.setAttribute("aria-hidden", "true");
  }
} else {
  document.querySelector("#secondaryBoard").src = "index.html?board=secondary";
}
