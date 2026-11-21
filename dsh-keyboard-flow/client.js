/* @local/dsh-plugin-keyboard-flow — browser half.
 *
 * Keyboard-first control for the workspace. Everything here is plain DOM work:
 * the client module system loads this file as a classic script, so it must call
 * __ModuleLoader__.load and export { apply, inject } the way built-in packages do.
 *
 * Behaviors:
 *   - Left tree: ArrowUp/ArrowDown (or j/k) and Home/End move focus,
 *     PageUp/PageDown jump a page, ArrowRight expands, ArrowLeft collapses,
 *     Enter/Space activates rows that do not open themselves.
 *   - Search results: rows become focusable so Tab/arrows/Enter reach them.
 *   - Conversation: j/k scroll one line, PageUp/PageDown scroll a page,
 *     Home/End jump to the top/bottom of the transcript.
 *   - Alt+J / Alt+K: step to the next / previous session.
 *   - F6: cycle focus between the session list, the composer, the transcript
 *     and the right panel. F7 toggles directly between the composer and the
 *     transcript.
 */
window.__ModuleLoader__.load({
  id: `@local/dsh-plugin-keyboard-flow`,
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;

    const LOG = `[keyboard-flow]`;
    const ROW = `[role="treeitem"]`;
    const TREE = `[role="tree"]`;
    const SESSION_ROW = `[data-row-key^="session:"]`;
    const CONVERSATION_CONTENT = `[data-conversation-content]`;
    const CONVERSATION_SCROLL = `[data-conversation-scroll]`;
    const MODAL = `[aria-modal="true"], [role="dialog"], dialog[open]`;

    function isElement(value) {
      return typeof Element !== `undefined` && value instanceof Element;
    }

    function isVisible(element) {
      if (!isElement(element)) return false;
      if (typeof element.getClientRects === `function` && element.getClientRects().length === 0) return false;
      return element.closest(`[hidden], [inert], [aria-hidden="true"]`) === null;
    }

    function isEditableTarget(element) {
      if (!isElement(element)) return false;
      if (element.isContentEditable) return true;
      const tag = element.tagName;
      if (tag === `INPUT` || tag === `TEXTAREA` || tag === `SELECT`) return true;
      // jsdom does not implement isContentEditable; the attribute check keeps the
      // composer (and anything inside it) out of the global key handler there too.
      return element.closest(`[contenteditable="true"], [contenteditable=""]`) !== null;
    }

    function rowsOf(tree) {
      return Array.from(tree.querySelectorAll(ROW)).filter(isVisible);
    }

    function rowOf(element) {
      if (!isElement(element)) return null;
      const direct = element.closest(ROW);
      if (direct !== null) return direct;
      const active = document.activeElement;
      return isElement(active) ? active.closest(ROW) : null;
    }

    function focusRow(row) {
      if (row === null) return;
      if (!row.hasAttribute(`tabindex`)) row.setAttribute(`tabindex`, `0`);
      row.focus();
      if (typeof row.scrollIntoView === `function`) row.scrollIntoView({ block: `nearest` });
    }

    function isModalOpen() {
      for (const element of document.querySelectorAll(MODAL)) {
        if (isVisible(element)) return true;
      }
      return false;
    }

    function scrollContainer(element) {
      let node = element;
      while (node !== null) {
        if (node.scrollHeight > node.clientHeight + 1) {
          const style = getComputedStyle(node);
          if (/(auto|scroll)/.test(style.overflowY)) return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    function conversationScroller() {
      const active = document.activeElement;
      if (isElement(active)) {
        const inside = active.closest(CONVERSATION_SCROLL);
        if (inside !== null && isVisible(inside)) return inside;
      }
      const candidates = Array.from(document.querySelectorAll(CONVERSATION_SCROLL)).filter(isVisible);
      const scrollable = candidates.find((element) => element.scrollHeight > element.clientHeight + 1);
      if (scrollable !== undefined) return scrollable;
      if (candidates.length > 0) return candidates[0];
      const content = document.querySelector(CONVERSATION_CONTENT);
      if (content === null) return null;
      const nested = content.querySelector(CONVERSATION_SCROLL);
      if (nested !== null) return nested;
      return scrollContainer(content);
    }

    function lineStep(scroller) {
      // The scrollport itself usually reports line-height: normal; the rendered
      // markdown paragraph carries the real reading line (21px/31px in DSH).
      const paragraph = scroller.querySelector(`p, li`);
      if (paragraph !== null) {
        const value = Number.parseFloat(getComputedStyle(paragraph).lineHeight);
        if (Number.isFinite(value) && value > 0) return value;
      }
      const own = Number.parseFloat(getComputedStyle(scroller).lineHeight);
      return Number.isFinite(own) && own > 0 ? own : 24;
    }

    function setScrollTop(scroller, top) {
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = Math.max(0, Math.min(max, top));
    }

    function scrollConversation(kind, scroller = conversationScroller()) {
      if (scroller === null) return false;
      const page = Math.max(80, Math.floor(scroller.clientHeight * 0.9));
      switch (kind) {
        case `line-down`:
          setScrollTop(scroller, scroller.scrollTop + lineStep(scroller));
          return true;
        case `line-up`:
          setScrollTop(scroller, scroller.scrollTop - lineStep(scroller));
          return true;
        case `page-down`:
          setScrollTop(scroller, scroller.scrollTop + page);
          return true;
        case `page-up`:
          setScrollTop(scroller, scroller.scrollTop - page);
          return true;
        case `top`:
          setScrollTop(scroller, 0);
          return true;
        case `bottom`:
          setScrollTop(scroller, scroller.scrollHeight);
          return true;
        default:
          return false;
      }
    }

    function isConversationTarget(target) {
      if (!isElement(target)) return true;
      if (target === document.body || target === document.documentElement) return true;
      if (target.closest(CONVERSATION_CONTENT) !== null) return true;
      return target.closest(CONVERSATION_SCROLL) !== null;
    }

    function hasNestedScroller(target, root) {
      // Only a target inside the transcript can be sitting in a nested scroller.
      // A body/document target (the common click-outside-the-composer case) must
      // not be compared against html/body scroll metrics.
      if (!isElement(target) || !root.contains(target)) return false;
      let node = target;
      while (node !== null && node !== root) {
        if (node.scrollHeight > node.clientHeight + 1) {
          const style = getComputedStyle(node);
          if (/(auto|scroll)/.test(style.overflowY)) return true;
        }
        node = node.parentElement;
      }
      return false;
    }

    function rowsPerPage(tree, rows) {
      const viewport = scrollContainer(tree) || tree;
      const height = viewport.clientHeight;
      const rowHeight = rows.length === 0 ? 0 : rows[0].getBoundingClientRect().height;
      if (height > 0 && rowHeight > 0) return Math.max(1, Math.floor(height / rowHeight) - 1);
      return Math.max(1, Math.floor(rows.length / 2));
    }

    function handleConversationKey(event, target) {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (event.shiftKey && (key === `j` || key === `k`)) return;
      let kind = null;
      switch (key) {
        case `j`:
          kind = `line-down`;
          break;
        case `k`:
          kind = `line-up`;
          break;
        case `PageDown`:
          kind = `page-down`;
          break;
        case `PageUp`:
          kind = `page-up`;
          break;
        case `Home`:
          kind = `top`;
          break;
        case `End`:
          kind = `bottom`;
          break;
        default:
          return;
      }
      if (!isConversationTarget(target)) return;
      if (isModalOpen()) return;
      const scroller = conversationScroller();
      if (scroller === null) return;
      if (hasNestedScroller(target, scroller)) return;
      if (scrollConversation(kind, scroller)) event.preventDefault();
    }

    function sessionRows() {
      return Array.from(document.querySelectorAll(SESSION_ROW)).filter(isVisible);
    }

    function stepSession(delta) {
      const rows = sessionRows();
      if (rows.length === 0) return;
      const current = rows.findIndex((row) => row.getAttribute(`aria-selected`) === `true`);
      const from = current === -1 ? 0 : current;
      const target = from + delta;
      if (target < 0 || target >= rows.length) return;
      const next = rows[target];
      focusRow(next);
      next.click();
    }

    function focusZoneResolvers() {
      return [
        () => document.querySelector(`[data-row-key^="session:"][aria-selected="true"]`),
        () =>
          document.querySelector(`[data-composer-seat] [contenteditable="true"]`) ??
          document.querySelector(`[contenteditable="true"]`),
        () => {
          // The transcript is not focusable on its own; tabindex -1 lets F6 land
          // there so j/k can scroll without clicking the conversation first. Skip
          // the stop when the transcript fits: there is nothing to scroll.
          const scroller = conversationScroller();
          if (scroller === null || scroller.scrollHeight <= scroller.clientHeight + 1) return null;
          if (!scroller.hasAttribute(`tabindex`)) scroller.setAttribute(`tabindex`, `-1`);
          return scroller;
        },
        () => document.querySelector(`[role="tab"][aria-selected="true"]`),
      ];
    }

    function cycleFocus() {
      const active = document.activeElement;
      const zones = focusZoneResolvers().map((resolve) => {
        try {
          return resolve();
        } catch (_error) {
          return null;
        }
      });
      const current = zones.findIndex(
        (zone) => zone !== null && zone !== undefined && active !== null && (zone === active || zone.contains(active)),
      );
      for (let step = 1; step <= zones.length; step += 1) {
        const zone = zones[(current + step) % zones.length];
        if (zone !== null && zone !== undefined) {
          zone.focus();
          return;
        }
      }
    }

    function insideComposer(element) {
      if (!isElement(element)) return false;
      if (element.isContentEditable) return true;
      if (element.closest(`[data-composer-seat]`) !== null) return true;
      return element.closest(`[contenteditable="true"], [contenteditable=""]`) !== null;
    }

    function toggleComposer() {
      const active = document.activeElement;
      if (insideComposer(active)) {
        const scroller = conversationScroller();
        if (scroller === null) return;
        if (!scroller.hasAttribute(`tabindex`)) scroller.setAttribute(`tabindex`, `-1`);
        scroller.focus();
        return;
      }
      const composer =
        document.querySelector(`[data-composer-seat] [contenteditable="true"]`) ??
        document.querySelector(`[contenteditable="true"]`);
      if (composer !== null) composer.focus();
    }

    function decorateNode(node) {
      if (!isElement(node)) return;
      const decorateRow = (row) => {
        if (!row.hasAttribute(`tabindex`)) row.setAttribute(`tabindex`, `0`);
      };
      if (node.matches(ROW) && node.closest(TREE) !== null) decorateRow(node);
      for (const row of node.querySelectorAll(ROW)) {
        if (row.closest(TREE) !== null) decorateRow(row);
      }
    }

    function decorateAll() {
      for (const tree of document.querySelectorAll(TREE)) {
        for (const row of tree.querySelectorAll(ROW)) {
          if (!row.hasAttribute(`tabindex`)) row.setAttribute(`tabindex`, `0`);
        }
      }
    }

    function onKeyDown(event) {
      if (event.defaultPrevented === true || event.isComposing === true) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (isEditableTarget(target)) return;
      const tree = isElement(target) ? target.closest(TREE) : null;
      if (tree === null) {
        handleConversationKey(event, target);
        return;
      }
      const rows = rowsOf(tree);
      if (rows.length === 0) return;
      const row = rowOf(target);
      const index = row === null ? -1 : rows.indexOf(row);
      const move = (to) => {
        const bounded = Math.max(0, Math.min(rows.length - 1, to));
        const next = rows[bounded];
        if (next === undefined) return;
        event.preventDefault();
        focusRow(next);
      };
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const page = rowsPerPage(tree, rows);
      switch (key) {
        case `j`:
          if (event.shiftKey) return;
          move(index + 1);
          return;
        case `k`:
          if (event.shiftKey) return;
          move(index - 1);
          return;
        case `PageDown`:
          move(index < 0 ? 0 : index + page);
          return;
        case `PageUp`:
          move(index < 0 ? rows.length - 1 : index - page);
          return;
        case `ArrowDown`:
          move(index + 1);
          return;
        case `ArrowUp`:
          move(index - 1);
          return;
        case `Home`:
          move(0);
          return;
        case `End`:
          move(rows.length - 1);
          return;
        case `ArrowRight`:
          if (row !== null && row.getAttribute(`aria-expanded`) === `false`) {
            event.preventDefault();
            row.click();
            return;
          }
          move(index + 1);
          return;
        case `ArrowLeft`:
          if (row !== null && row.getAttribute(`aria-expanded`) === `true`) {
            event.preventDefault();
            row.click();
            return;
          }
          move(index - 1);
          return;
        case `Enter`:
        case ` `: {
          if (row === null) return;
          const rowKey = row.getAttribute(`data-row-key`);
          if (rowKey !== null && rowKey.startsWith(`session:`)) return;
          event.preventDefault();
          row.click();
          return;
        }
        default:
          return;
      }
    }

    // Desktop only: the registry validates every default against the browser
    // allowlist (isWebBindingAllowed) even when the runtime is desktop, and it
    // throws for F6 or Alt+<key> there. Browser runtimes leave these commands
    // unbound so the user can pick an allowed combination in the dialog.
    const DESKTOP_PLATFORMS = [`desktop:macos`, `desktop:windows`, `desktop:linux`];
    // Linux desktop skips the windows/macos shortcut in bindingIssue and rejects
    // modifier-less bindings as `modifier-required`, so F6 may only default on
    // macos/windows.
    const FKEY_PLATFORMS = [`desktop:macos`, `desktop:windows`];

    function defaultsFor(code, modifiers, platforms = DESKTOP_PLATFORMS) {
      const defaults = {};
      for (const platform of platforms) defaults[platform] = { code, modifiers };
      return defaults;
    }

    function registerCommand(shortcuts, definition) {
      try {
        const dispose = shortcuts.register(definition);
        return typeof dispose === `function` ? dispose : () => {};
      } catch (error) {
        console.warn(LOG, `command not registered:`, definition.id, error);
        return () => {};
      }
    }

    function installCommands(shortcuts) {
      const commands = [
        {
          id: `focus.cycle`,
          label: () => `在会话列表、输入框、会话内容和右侧面板之间切换焦点`,
          aliases: [`cycle focus`, `next region`],
          defaults: defaultsFor(`F6`, [], FKEY_PLATFORMS),
          regions: [`page`, `editable`, `terminal`],
          modals: [],
          resolve: () => ({ status: `handled`, run: cycleFocus }),
        },
        {
          id: `focus.toggleComposer`,
          label: () => `在输入框和会话内容之间切换焦点`,
          aliases: [`toggle composer`, `toggle input`, `focus conversation`],
          defaults: defaultsFor(`F7`, [], FKEY_PLATFORMS),
          regions: [`page`, `editable`],
          modals: [],
          resolve: (context) => {
            if (context.region === `terminal`) return { status: `pass` };
            if (context.modal !== null && context.modal !== undefined) return { status: `pass` };
            return { status: `handled`, run: toggleComposer };
          },
        },
        {
          id: `session.next`,
          label: () => `下一个会话`,
          aliases: [`next session`],
          defaults: defaultsFor(`KeyJ`, [`alt`]),
          regions: [`page`, `editable`, `terminal`],
          modals: [],
          resolve: () => ({ status: `handled`, run: () => stepSession(1) }),
        },
        {
          id: `session.previous`,
          label: () => `上一个会话`,
          aliases: [`previous session`],
          defaults: defaultsFor(`KeyK`, [`alt`]),
          regions: [`page`, `editable`, `terminal`],
          modals: [],
          resolve: () => ({ status: `handled`, run: () => stepSession(-1) }),
        },
      ];
      const disposers = commands.map((command) => registerCommand(shortcuts, command));
      return () => {
        for (const dispose of disposers) dispose();
      };
    }

    function apply(ctx) {
      try {
        ctx.effect(() => {
          document.addEventListener(`keydown`, onKeyDown, true);
          const observer = new MutationObserver((records) => {
            for (const record of records) {
              for (const node of record.addedNodes) decorateNode(node);
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          decorateAll();
          return () => {
            document.removeEventListener(`keydown`, onKeyDown, true);
            observer.disconnect();
          };
        }, `keyboard-flow: tree navigation`);
      } catch (error) {
        console.warn(LOG, `tree navigation failed`, error);
      }

      const shortcuts = typeof ctx.get === `function` ? ctx.get(`shortcuts`) : ctx.shortcuts;
      if (shortcuts !== undefined && shortcuts !== null) {
        try {
          ctx.effect(() => installCommands(shortcuts), `keyboard-flow: commands`);
        } catch (error) {
          console.warn(LOG, `commands failed`, error);
        }
      } else {
        console.warn(LOG, `shortcuts service unavailable; commands not registered`);
      }
    }

    exports.apply = apply;
    exports.inject = [`shortcuts`];
    return module.exports;
  },
});
