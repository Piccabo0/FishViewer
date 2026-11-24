"use strict";

const dashboard = document.querySelector("#dashboard");
const pageDots = [...document.querySelectorAll(".page-dot")];
const pages = [
  [document.querySelector(".visualization-panel"), document.querySelector(".console-panel")],
  [document.querySelector("#secondaryBoard")],
];
const allPanels = [...new Set(pages.flat())];

let transitionId = 0;
let runningAnimations = [];

function setPage(index) {
  dashboard.dataset.activePage = String(index);
  document.body.classList.toggle("page-two", index === 1);
  allPanels.forEach((panel) => {
    const visible = pages[index].includes(panel);
    panel.inert = !visible;
    if (visible) panel.removeAttribute("aria-hidden");
    else panel.setAttribute("aria-hidden", "true");
  });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function setActiveDot(index) {
  pageDots.forEach((dot, pageIndex) => {
    dot.classList.toggle("active", pageIndex === index);
    if (pageIndex === index) dot.setAttribute("aria-current", "page");
    else dot.removeAttribute("aria-current");
  });
}

async function showPage(index) {
  const current = Number(dashboard.dataset.activePage);
  if (index === current) {
    ++transitionId;
    runningAnimations.forEach((animation) => animation.cancel());
    runningAnimations = [];
    setActiveDot(index);
    return;
  }

  const id = ++transitionId;
  runningAnimations.forEach((animation) => animation.cancel());
  runningAnimations = [];
  setActiveDot(index);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setPage(index);
    return;
  }

  const direction = index > current ? -1 : 1;
  runningAnimations = pages[current].map((panel) => panel.animate(
    [
      { opacity: 1, transform: "translateX(0)" },
      { opacity: 0, transform: `translateX(${direction * 18}px)` },
    ],
    { duration: 190, easing: "ease-in", fill: "forwards" }
  ));
  await Promise.allSettled(runningAnimations.map((animation) => animation.finished));
  if (id !== transitionId) return;

  setPage(index);
  runningAnimations.forEach((animation) => animation.cancel());
  runningAnimations = pages[index].map((panel) => panel.animate(
    [
      { opacity: 0, transform: `translateX(${-direction * 18}px)` },
      { opacity: 1, transform: "translateX(0)" },
    ],
    { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
  ));
  await Promise.allSettled(runningAnimations.map((animation) => animation.finished));
  if (id === transitionId) runningAnimations = [];
}

pageDots.forEach((dot, index) => {
  dot.addEventListener("click", () => showPage(index));
  dot.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + pageDots.length) % pageDots.length;
    pageDots[next].focus();
    showPage(next);
  });
});
