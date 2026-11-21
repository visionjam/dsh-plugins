import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");

const html = [
  "<!doctype html><html><body>",
  '<div id="sidebar">',
  '  <div role="tree" aria-label="workspaces">',
  '    <div role="treeitem" data-row-key="workspace:w1" aria-expanded="false" tabindex="0" id="ws">Project</div>',
  '    <div role="treeitem" data-row-key="session:s1" aria-selected="true" tabindex="0" id="s1">Session 1</div>',
  '    <div role="treeitem" data-row-key="session:s2" tabindex="0" id="s2">Session 2</div>',
  '    <div role="treeitem" data-row-key="session:s3" tabindex="0" id="s3">Session 3</div>',
  "  </div>",
  "</div>",
  '<div id="search"><div role="tree" aria-label="results">',
  '  <div role="treeitem" id="r1">Result A</div>',
  '  <div role="treeitem" id="r2">Result B</div>',
  "</div></div>",
  '<div id="main" data-conversation-content>',
  '  <div data-conversation-scroll id="scroller">',
  '    <div id="turns">Turns</div>',
  '    <div id="nested" style="overflow-y: auto" tabindex="0"><div id="nested-content" tabindex="0">Code</div></div>',
  '    <div data-composer-seat><div contenteditable="true" id="composer"></div></div>',
  "  </div>",
  "</div>",
  '<div id="right"><div role="tablist"><div role="tab" aria-selected="true" tabindex="0" id="tab1">Files</div></div></div>',
  "</body></html>",
].join("\n");

function build() {
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  // jsdom has no layout: every element would report zero client rects.
  window.Element.prototype.getClientRects = function getClientRects() {
    return [{ width: 100, height: 20 }];
  };
  // The transcript scrollport is a real DOM node in DSH; give the test one a
  // fixed viewport and content height so the scroll math is observable.
  const scroller = window.document.getElementById("scroller");
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1200 });
  scroller.scrollTop = 0;
  const nested = window.document.getElementById("nested");
  Object.defineProperty(nested, "clientHeight", { configurable: true, value: 100 });
  Object.defineProperty(nested, "scrollHeight", { configurable: true, value: 200 });
  let exported = null;
  window.__ModuleLoader__ = {
    load({ id, factory }) {
      exported = { id, exports: factory(() => { throw new Error("no requires expected"); }) };
    },
  };
  window.eval(source);
  return { dom, window, exported };
}

function harness() {
  const { dom, window, exported } = build();
  const commands = new Map();
  const shortcuts = {
    register(definition) {
      commands.set(definition.id, definition);
      return () => commands.delete(definition.id);
    },
  };
  const disposers = [];
  const ctx = {
    shortcuts,
    // The client context exposes services through get(); apply() prefers it.
    get(name) {
      return name === "shortcuts" ? shortcuts : undefined;
    },
    effect(callback) {
      const dispose = callback();
      disposers.push(dispose);
      return dispose;
    },
  };
  exported.exports.apply(ctx);
  return { dom, window, commands, disposeAll: () => disposers.forEach((d) => d && d()) };
}

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " :: got " + JSON.stringify(actual) + " want " + JSON.stringify(expected)));
}

function press(window, element, key, init = {}) {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  return event;
}

// 1. Arrow keys walk the tree.
{
  const { window } = harness();
  const s1 = window.document.getElementById("s1");
  const s2 = window.document.getElementById("s2");
  s1.focus();
  press(window, s1, "ArrowDown");
  check("ArrowDown moves to next row", window.document.activeElement.id, "s2");
  press(window, s2, "ArrowUp");
  check("ArrowUp moves back", window.document.activeElement.id, "s1");
  press(window, s1, "End");
  check("End jumps to last row", window.document.activeElement.id, "s3");
  press(window, window.document.getElementById("s3"), "Home");
  check("Home jumps to first row", window.document.activeElement.id, "ws");
}

// 2. ArrowRight expands a collapsed workspace row, ArrowLeft collapses it.
{
  const { window } = harness();
  const ws = window.document.getElementById("ws");
  let clicks = 0;
  ws.addEventListener("click", () => { clicks += 1; });
  ws.focus();
  const right = press(window, ws, "ArrowRight");
  check("ArrowRight clicks a collapsed row", clicks, 1);
  check("ArrowRight is consumed", right.defaultPrevented, true);
  ws.setAttribute("aria-expanded", "true");
  press(window, ws, "ArrowLeft");
  check("ArrowLeft clicks an expanded row", clicks, 2);
}

// 3. Enter activates rows that do not open themselves (search results).
{
  const { window } = harness();
  const r1 = window.document.getElementById("r1");
  check("search result became focusable", r1.getAttribute("tabindex"), "0");
  let clicks = 0;
  r1.addEventListener("click", () => { clicks += 1; });
  r1.focus();
  press(window, r1, "Enter");
  check("Enter clicks a search result", clicks, 1);
  press(window, r1, " ");
  check("Space clicks a search result", clicks, 2);
}

// 4. Session rows keep their own Enter handling (no double activation).
{
  const { window } = harness();
  const s1 = window.document.getElementById("s1");
  let clicks = 0;
  s1.addEventListener("click", () => { clicks += 1; });
  s1.focus();
  press(window, s1, "Enter");
  check("Enter is left to the session row", clicks, 0);
}

// 5. The composer keeps its arrow keys and its letters.
{
  const { window } = harness();
  const composer = window.document.getElementById("composer");
  const scroller = window.document.getElementById("scroller");
  composer.focus();
  const down = press(window, composer, "ArrowDown");
  check("ArrowDown in the composer is not intercepted", window.document.activeElement.id, "composer");
  check("ArrowDown in the composer is not consumed", down.defaultPrevented, false);
  const j = press(window, composer, "j");
  check("j in the composer is not intercepted", window.document.activeElement.id, "composer");
  check("j in the composer is not consumed", j.defaultPrevented, false);
  check("j in the composer does not scroll", scroller.scrollTop, 0);
}

// 6. j/k and PageUp/PageDown work in the tree.
{
  const { window } = harness();
  const s1 = window.document.getElementById("s1");
  const s2 = window.document.getElementById("s2");
  const s3 = window.document.getElementById("s3");
  s1.focus();
  press(window, s1, "j");
  check("j moves to the next row", window.document.activeElement.id, "s2");
  press(window, s2, "k");
  check("k moves back", window.document.activeElement.id, "s1");
  press(window, s1, "J", { shiftKey: true });
  check("Shift+J is left alone", window.document.activeElement.id, "s1");
  press(window, s1, "PageDown");
  check("PageDown jumps a page of rows", window.document.activeElement.id, "s3");
  press(window, s3, "PageUp");
  check("PageUp jumps back a page", window.document.activeElement.id, "s1");
}

// 7. Conversation scrolling keys move the transcript scroller.
{
  const { window } = harness();
  const scroller = window.document.getElementById("scroller");
  const body = window.document.body;
  const down = press(window, body, "j");
  check("j scrolls one line", scroller.scrollTop, 24);
  check("j is consumed", down.defaultPrevented, true);
  press(window, body, "k");
  check("k scrolls back", scroller.scrollTop, 0);
  press(window, body, "k");
  check("k at the top stays at the top", scroller.scrollTop, 0);
  press(window, body, "PageDown");
  check("PageDown scrolls a page", scroller.scrollTop, 360);
  press(window, body, "PageUp");
  check("PageUp scrolls back a page", scroller.scrollTop, 0);
  press(window, body, "End");
  check("End jumps to the bottom", scroller.scrollTop, 800);
  press(window, body, "Home");
  check("Home jumps to the top", scroller.scrollTop, 0);
  press(window, body, "J", { shiftKey: true });
  check("Shift+J does not scroll", scroller.scrollTop, 0);
  const nestedContent = window.document.getElementById("nested-content");
  nestedContent.focus();
  press(window, nestedContent, "j");
  check("j inside a nested scroller leaves the transcript alone", scroller.scrollTop, 0);
}

// 8. Scrolling keys leave the right panel alone.
{
  const { window } = harness();
  const scroller = window.document.getElementById("scroller");
  const tab = window.document.getElementById("tab1");
  tab.focus();
  press(window, tab, "PageDown");
  check("PageDown on a right-panel tab leaves the transcript alone", scroller.scrollTop, 0);
}

// 9. An open modal owns the keyboard.
{
  const { window } = harness();
  const scroller = window.document.getElementById("scroller");
  const modal = window.document.createElement("div");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  window.document.body.appendChild(modal);
  press(window, window.document.body, "j");
  check("j does not scroll behind a modal", scroller.scrollTop, 0);
}

// 10. Alt+J / Alt+K step through sessions.
{
  const { window, commands } = harness();
  const opened = [];
  for (const id of ["s1", "s2", "s3"]) {
    window.document.getElementById(id).addEventListener("click", () => opened.push(id));
  }
  commands.get("session.next").resolve().run();
  check("session.next opens the next session", opened, ["s2"]);
  // React would move aria-selected to the opened row; mirror that before stepping back.
  window.document.getElementById("s1").setAttribute("aria-selected", "false");
  window.document.getElementById("s2").setAttribute("aria-selected", "true");
  commands.get("session.previous").resolve().run();
  check("session.previous opens the previous session", opened, ["s2", "s1"]);
}

// 11. F6 cycles focus through the transcript and the right panel.
{
  const { window, commands } = harness();
  const composer = window.document.getElementById("composer");
  composer.focus();
  commands.get("focus.cycle").resolve().run();
  check("F6 moves focus to the transcript", window.document.activeElement.id, "scroller");
  commands.get("focus.cycle").resolve().run();
  check("F6 moves focus to the right panel tab", window.document.activeElement.id, "tab1");
  commands.get("focus.cycle").resolve().run();
  check("F6 wraps back to the session list", window.document.activeElement.id, "s1");
  commands.get("focus.cycle").resolve().run();
  check("F6 returns to the composer", window.document.activeElement.id, "composer");
  const toggle = commands.get("focus.toggleComposer");
  toggle.resolve({ region: "editable", modal: null, target: composer }).run();
  check("F7 toggles from the composer to the transcript", window.document.activeElement.id, "scroller");
  toggle.resolve({ region: "page", modal: null, target: window.document.getElementById("scroller") }).run();
  check("F7 toggles back to the composer", window.document.activeElement.id, "composer");
  check("F7 passes in the terminal", toggle.resolve({ region: "terminal", modal: null, target: null }).status, "pass");
  check("F7 passes in a modal", toggle.resolve({ region: "page", modal: "other", target: null }).status, "pass");
}

// 12. Registered commands carry usable defaults.
{
  const { commands } = harness();
  check("session.next defaults", commands.get("session.next").defaults["desktop:windows"], { code: "KeyJ", modifiers: ["alt"] });
  check("focus.cycle defaults", commands.get("focus.cycle").defaults["desktop:windows"], { code: "F6", modifiers: [] });
  check("focus.toggleComposer defaults", commands.get("focus.toggleComposer").defaults["desktop:windows"], { code: "F7", modifiers: [] });
  // The registry validates web defaults against a browser allowlist and throws for
  // F6 / Alt+<key>; leaving web unbound keeps register() from rejecting the command.
  check("no web defaults", Object.keys(commands.get("focus.cycle").defaults).filter((k) => k.startsWith("web:")), []);
  // desktop:linux rejects modifier-less defaults as modifier-required, which makes
  // register() throw, so F6 is only defaulted on macos/windows.
  check("no linux default for F6", commands.get("focus.cycle").defaults["desktop:linux"] ?? null, null);
  check("no linux default for F7", commands.get("focus.toggleComposer").defaults["desktop:linux"] ?? null, null);
  // Scrolling is implemented in the capture listener (it must honour key repeat
  // and stay out of the shortcut registry's region/priority rules).
  check("only the four focus/session commands are registered", [...commands.keys()].sort(), ["focus.cycle", "focus.toggleComposer", "session.next", "session.previous"]);
}

// 13. Disposing removes the listeners.
{
  const { window, disposeAll } = harness();
  const scroller = window.document.getElementById("scroller");
  disposeAll();
  press(window, window.document.body, "j");
  check("dispose stops conversation scrolling", scroller.scrollTop, 0);
  const s1 = window.document.getElementById("s1");
  s1.focus();
  press(window, s1, "ArrowDown");
  check("dispose stops tree navigation", window.document.activeElement.id, "s1");
}

console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
