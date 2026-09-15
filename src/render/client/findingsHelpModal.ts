import { byId } from "./dom";

let backdrop: HTMLElement;
let bodyEl: HTMLElement;
let closeBtn: HTMLButtonElement;
// Focus returns to the `?` icon that opened the modal, so keyboard and
// screen-reader users keep their place in the findings list.
let opener: HTMLElement | null = null;

function close(): void {
  backdrop.hidden = true;
  bodyEl.replaceChildren();
  if (opener) {
    opener.focus();
    opener = null;
  }
}

export function initHelpModal(): void {
  backdrop = byId("helpModalBackdrop");
  bodyEl = byId("helpModalBody");
  closeBtn = byId<HTMLButtonElement>("helpModalClose");

  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !backdrop.hidden) close();
  });
}

// `html` is a developer-authored fragment baked in at build time
// (src/render/client/help/*.html), never user input, so innerHTML is safe.
export function showHelp(html: string, triggeredBy: HTMLElement): void {
  opener = triggeredBy;
  bodyEl.innerHTML = html;
  backdrop.hidden = false;
  bodyEl.scrollTop = 0;
  closeBtn.focus();
}
