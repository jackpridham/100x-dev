(function exposeVortexPullRequest(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VortexGitControlPullRequest = api;
})(typeof globalThis === "object" ? globalThis : this, function createVortexPullRequest() {
  "use strict";

  const CURRENT_CONTROL_SELECTOR = 'button[aria-label="Viewed"][aria-pressed]';
  const LEGACY_CONTROL_SELECTOR = 'input[type="checkbox"][name="viewed"]';
  const COMPONENT_LABEL_SELECTOR = '[data-component="text"]';
  const DIFF_HEADER_SELECTOR = '[data-diff-header-wrapper="true"]';
  const EXPAND_ALL_LABEL_PREFIX = "Expand all lines: ";
  const MAX_VIRTUALIZED_SCAN_STEPS = 20;

  function parsePullRequestFilesUrl(href) {
    let url;
    try { url = new URL(href); } catch { return null; }
    if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 5 || parts[2] !== "pull" || !/^\d+$/u.test(parts[3]) || !["files", "changes"].includes(parts[4])) return null;
    const number = Number(parts[3]);
    if (!Number.isSafeInteger(number) || number < 1 || parts[0].includes("%") || parts[1].includes("%")) return null;
    return { owner: parts[0], repo: parts[1], number };
  }

  function attr(node, name) {
    return node && typeof node.getAttribute === "function" ? node.getAttribute(name) : null;
  }

  function parentOf(node) {
    return node && (node.parentElement || node.parentNode) || null;
  }

  function query(node, selector) {
    return node && typeof node.querySelector === "function" ? node.querySelector(selector) : null;
  }

  function queryAll(node, selector) {
    return node && typeof node.querySelectorAll === "function" ? Array.from(node.querySelectorAll(selector)) : [];
  }

  function normalizedText(node) {
    return node && typeof node.textContent === "string" ? node.textContent.trim().replace(/\s+/gu, " ") : "";
  }

  function isCurrentControl(control) {
    if (attr(control, "aria-pressed") === null) return false;
    if (attr(control, "aria-label") === "Viewed") return true;
    return normalizedText(query(control, COMPONENT_LABEL_SELECTOR)) === "Viewed";
  }

  function currentControls(node) {
    return [...new Set([
      ...queryAll(node, CURRENT_CONTROL_SELECTOR),
      ...queryAll(node, "button").filter(isCurrentControl)
    ])];
  }

  function virtualizedPath(region) {
    for (const labelledElement of queryAll(region, "[aria-label]")) {
      const label = attr(labelledElement, "aria-label");
      if (label && label.startsWith(EXPAND_ALL_LABEL_PREFIX)) {
        const path = label.slice(EXPAND_ALL_LABEL_PREFIX.length).trim();
        if (path) return path;
      }
    }
    return null;
  }

  function fileContainerFromControl(control) {
    let current = control;
    while (current) {
      if (attr(current, "data-file-path") || attr(current, "data-tagsearch-path") || attr(current, "data-path")) return current;
      if (attr(current, "role") === "region" && String(attr(current, "id") || "").startsWith("diff-")) return current;
      current = parentOf(current);
    }
    return null;
  }

  function pathFromContainer(container) {
    return attr(container, "data-file-path") || attr(container, "data-tagsearch-path") || attr(container, "data-path") || virtualizedPath(container);
  }

  function addFile(files, controls, path, control, container) {
    if (!container) return;
    const existing = files.find((file) => file.container === container || (path && file.path === path));
    if (existing) {
      if (!existing.control && control) existing.control = control;
      return;
    }
    files.push({ path, control, container });
    if (control) controls.add(control);
  }

  function exposedFiles(documentObject) {
    const files = [];
    const controls = new Set();
    for (const entry of queryAll(documentObject, "copilot-diff-entry[data-file-path]")) {
      const control = currentControls(entry)[0] || query(entry, LEGACY_CONTROL_SELECTOR);
      addFile(files, controls, attr(entry, "data-file-path"), control, entry);
    }
    for (const control of [...currentControls(documentObject), ...queryAll(documentObject, LEGACY_CONTROL_SELECTOR)]) {
      if (controls.has(control)) continue;
      const container = fileContainerFromControl(control);
      addFile(files, controls, pathFromContainer(container), control, container);
    }
    return files.sort((left, right) => {
      if (!left.container || typeof left.container.compareDocumentPosition !== "function") return 0;
      const position = left.container.compareDocumentPosition(right.container);
      if (position & 4) return -1;
      if (position & 2) return 1;
      return 0;
    });
  }

  function contains(container, node) {
    if (!container || !node) return false;
    if (container === node) return true;
    return typeof container.contains === "function" && container.contains(node);
  }

  function visibleHeight(container, viewportHeight) {
    if (!container || typeof container.getBoundingClientRect !== "function") return 0;
    const rect = container.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) return 0;
    return Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
  }

  function selectCurrentFile(files, documentObject) {
    const view = documentObject && documentObject.defaultView;
    const viewportWidth = view && Number.isFinite(view.innerWidth) ? view.innerWidth : 0;
    const viewportHeight = view && Number.isFinite(view.innerHeight) ? view.innerHeight : 0;
    const topmostHeader = queryAll(documentObject, DIFF_HEADER_SELECTOR)
      .map((header) => ({ header, rect: typeof header.getBoundingClientRect === "function" ? header.getBoundingClientRect() : null }))
      .filter(({ rect }) => rect && Number.isFinite(rect.top) && Number.isFinite(rect.bottom) && rect.top >= 0 && rect.top < viewportHeight && rect.bottom > 0)
      .sort((left, right) => left.rect.top - right.rect.top)[0];
    if (topmostHeader) {
      const sticky = files.find((file) => contains(file.container, topmostHeader.header));
      if (sticky) return sticky;
    }

    const focused = files.find((file) => contains(file.container, documentObject && documentObject.activeElement));
    if (focused) return focused;

    if (viewportWidth > 0 && viewportHeight > 0 && typeof documentObject.elementFromPoint === "function") {
      const centeredNode = documentObject.elementFromPoint(viewportWidth / 2, viewportHeight / 2);
      const centered = files.find((file) => contains(file.container, centeredNode));
      if (centered) return centered;
    }

    let mostVisible = null;
    let mostVisibleHeight = 0;
    for (const file of files) {
      const height = visibleHeight(file.container, viewportHeight);
      if (height > mostVisibleHeight) {
        mostVisible = file;
        mostVisibleHeight = height;
      }
    }
    return mostVisible;
  }

  function isViewed(control) {
    if (!control) return false;
    if (attr(control, "aria-pressed") !== null) return attr(control, "aria-pressed") === "true";
    return control.checked === true;
  }

  function resultFor(status, file) {
    return file && file.path ? { status, path: file.path } : { status };
  }

  function ancestorAttribute(node, name) {
    let current = node;
    while (current) {
      const value = attr(current, name);
      if (value) return value;
      current = parentOf(current);
    }
    return null;
  }

  function ancestorDiffId(node) {
    let current = node;
    while (current) {
      const id = attr(current, "id");
      if (id && id.startsWith("diff-")) return id;
      current = parentOf(current);
    }
    return null;
  }

  function fileIdentity(file) {
    if (file.path) return `path:${file.path}`;
    const diffId = ancestorDiffId(file.container);
    if (diffId) return `diff:${diffId}`;
    const pathDigest = ancestorAttribute(file.container, "data-path-digest");
    if (pathDigest) return `digest:${pathDigest}`;
    const virtualIndex = ancestorAttribute(file.container, "data-index");
    return virtualIndex ? `index:${virtualIndex}` : null;
  }

  function rememberFile(file, identities, containers) {
    const identity = fileIdentity(file);
    if (identity) {
      identities.add(identity);
    } else if (file.container && (typeof file.container === "object" || typeof file.container === "function")) {
      containers.add(file.container);
    }
  }

  function wasRemembered(file, identities, containers) {
    const identity = fileIdentity(file);
    return identity ? identities.has(identity) : Boolean(file.container && containers.has(file.container));
  }

  function sameFile(left, right) {
    const leftIdentity = fileIdentity(left);
    const rightIdentity = fileIdentity(right);
    if (leftIdentity || rightIdentity) return Boolean(leftIdentity && leftIdentity === rightIdentity);
    return Boolean(left.container && left.container === right.container);
  }

  function scrollMetrics(documentObject) {
    const view = documentObject && documentObject.defaultView;
    const scrollingElement = documentObject && (
      documentObject.scrollingElement || documentObject.documentElement || documentObject.body
    );
    const viewportHeight = view && Number.isFinite(view.innerHeight)
      ? view.innerHeight
      : scrollingElement && Number.isFinite(scrollingElement.clientHeight) ? scrollingElement.clientHeight : 0;
    const scrollTop = view && Number.isFinite(view.scrollY)
      ? view.scrollY
      : scrollingElement && Number.isFinite(scrollingElement.scrollTop) ? scrollingElement.scrollTop : 0;
    const scrollHeight = scrollingElement && Number.isFinite(scrollingElement.scrollHeight)
      ? scrollingElement.scrollHeight
      : 0;
    return { view, scrollingElement, viewportHeight, scrollTop, scrollHeight };
  }

  function setScrollTop(view, scrollingElement, scrollTop) {
    const options = { top: scrollTop, behavior: "auto" };
    if (view && typeof view.scrollTo === "function") view.scrollTo(options);
    else if (scrollingElement && typeof scrollingElement.scrollTo === "function") scrollingElement.scrollTo(options);
    else if (scrollingElement) scrollingElement.scrollTop = scrollTop;
    else return false;
    return true;
  }

  function advanceVirtualizedPage(documentObject, files) {
    const { view, scrollingElement, viewportHeight, scrollTop, scrollHeight } = scrollMetrics(documentObject);
    if (viewportHeight <= 0 || scrollHeight <= viewportHeight) return null;
    const maxScrollTop = Math.max(0, scrollHeight - viewportHeight);
    let lowestMountedBottom = scrollTop;
    for (const file of files) {
      if (!file.container || typeof file.container.getBoundingClientRect !== "function") continue;
      const rect = file.container.getBoundingClientRect();
      if (rect && Number.isFinite(rect.bottom)) {
        lowestMountedBottom = Math.max(lowestMountedBottom, scrollTop + rect.bottom);
      }
    }
    const nextScrollTop = Math.min(maxScrollTop, Math.max(scrollTop + viewportHeight, lowestMountedBottom));
    if (nextScrollTop <= scrollTop) return null;
    if (!setScrollTop(view, scrollingElement, nextScrollTop)) return null;
    return nextScrollTop;
  }

  function advanceTowardPendingFile(documentObject, file) {
    const { view, scrollingElement, viewportHeight, scrollTop, scrollHeight } = scrollMetrics(documentObject);
    const maxScrollTop = Math.max(0, scrollHeight - viewportHeight);
    let nextScrollTop = scrollTop;
    if (file && file.container && typeof file.container.getBoundingClientRect === "function") {
      const rect = file.container.getBoundingClientRect();
      if (rect && Number.isFinite(rect.top)) {
        nextScrollTop = Math.min(maxScrollTop, Math.max(scrollTop, scrollTop + rect.top));
      }
    }
    if (nextScrollTop > scrollTop) setScrollTop(view, scrollingElement, nextScrollTop);
    return nextScrollTop;
  }

  function defaultWaitForRender({ document: documentObject } = {}) {
    const view = documentObject && documentObject.defaultView;
    const schedule = view && typeof view.setTimeout === "function"
      ? view.setTimeout.bind(view)
      : setTimeout;
    return new Promise((resolve) => {
      if (view && typeof view.requestAnimationFrame === "function") {
        view.requestAnimationFrame(() => view.requestAnimationFrame(() => schedule(resolve, 25)));
      } else {
        schedule(resolve, 50);
      }
    });
  }

  function defaultWaitAfterMark({ document: documentObject, signal } = {}) {
    if (signal && signal.aborted) return Promise.resolve();
    const view = documentObject && documentObject.defaultView;
    const schedule = view && typeof view.setTimeout === "function"
      ? view.setTimeout.bind(view)
      : setTimeout;
    const cancelTimeout = view && typeof view.clearTimeout === "function"
      ? view.clearTimeout.bind(view)
      : clearTimeout;
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const animationFrames = [];
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer !== null) cancelTimeout(timer);
        if (view && typeof view.cancelAnimationFrame === "function") {
          for (const frame of animationFrames) view.cancelAnimationFrame(frame);
        }
        if (signal && typeof signal.removeEventListener === "function") {
          signal.removeEventListener("abort", finish);
        }
        resolve();
      };
      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", finish, { once: true });
      }
      if (view && typeof view.requestAnimationFrame === "function") {
        animationFrames.push(view.requestAnimationFrame(() => {
          if (settled) return;
          animationFrames.push(view.requestAnimationFrame(() => {
            if (!settled) timer = schedule(finish, 100);
          }));
        }));
      } else {
        timer = schedule(finish, 125);
      }
    });
  }

  function currentFileSelection(documentObject, href) {
    if (!parsePullRequestFilesUrl(href)) return { result: { status: "wrong-page" } };
    const files = exposedFiles(documentObject);
    if (!files.length) return { result: { status: "missing-controls" } };
    const current = selectCurrentFile(files, documentObject);
    if (!current) return { result: { status: "no-current-file" } };
    return { files, current };
  }

  function markSelectedFileViewed(current) {
    if (!current.control || typeof current.control.click !== "function") return resultFor("missing-controls", current);
    if (isViewed(current.control)) return resultFor("already-viewed", current);
    current.control.click();
    return resultFor("success", current);
  }

  function scannedThrough(files, current) {
    const scannedIdentities = new Set();
    const scannedContainers = new WeakSet();
    for (const file of files.slice(0, files.indexOf(current) + 1)) {
      rememberFile(file, scannedIdentities, scannedContainers);
    }
    return { scannedIdentities, scannedContainers };
  }

  async function scanNextUnviewedFile({
    document: documentObject,
    files,
    scannedIdentities,
    scannedContainers,
    signal,
    waitForRender
  }) {
    let pendingFile = null;

    for (let scanStep = 0; scanStep <= MAX_VIRTUALIZED_SCAN_STEPS; scanStep += 1) {
      if (signal && signal.aborted) return { status: "cancelled" };
      if (pendingFile) {
        const remountedPending = files.find((file) => sameFile(file, pendingFile));
        if (remountedPending) pendingFile = remountedPending;
        if (remountedPending && remountedPending.control) {
          rememberFile(remountedPending, scannedIdentities, scannedContainers);
          pendingFile = null;
          if (!isViewed(remountedPending.control)) {
            if (signal && signal.aborted) return { status: "cancelled" };
            const target = query(remountedPending.container, DIFF_HEADER_SELECTOR) || remountedPending.container;
            if (target && typeof target.scrollIntoView === "function") {
              target.scrollIntoView({ block: "start", behavior: "smooth" });
            }
            return resultFor("success", remountedPending);
          }
        }
      }

      if (!pendingFile) {
        for (const file of files) {
          if (wasRemembered(file, scannedIdentities, scannedContainers)) continue;
          if (!file.control) {
            pendingFile = file;
            break;
          }
          rememberFile(file, scannedIdentities, scannedContainers);
          if (isViewed(file.control)) continue;
          if (signal && signal.aborted) return { status: "cancelled" };
          const target = query(file.container, DIFF_HEADER_SELECTOR) || file.container;
          if (target && typeof target.scrollIntoView === "function") {
            target.scrollIntoView({ block: "start", behavior: "smooth" });
          }
          return resultFor("success", file);
        }
      }

      if (scanStep === MAX_VIRTUALIZED_SCAN_STEPS) {
        return pendingFile ? resultFor("missing-controls", pendingFile) : { status: "no-next-unviewed" };
      }
      if (signal && signal.aborted) return { status: "cancelled" };
      const nextScrollTop = pendingFile
        ? advanceTowardPendingFile(documentObject, pendingFile)
        : advanceVirtualizedPage(documentObject, files);
      if (nextScrollTop === null) {
        return pendingFile ? resultFor("missing-controls", pendingFile) : { status: "no-next-unviewed" };
      }
      if (typeof waitForRender === "function") {
        await waitForRender({ document: documentObject, scanStep: scanStep + 1, scrollTop: nextScrollTop });
      }
      if (signal && signal.aborted) return { status: "cancelled" };
      files = exposedFiles(documentObject);
    }
    return pendingFile ? resultFor("missing-controls", pendingFile) : { status: "no-next-unviewed" };
  }

  async function markCurrentFileViewed({ document: documentObject, href } = {}) {
    const selection = currentFileSelection(documentObject, href);
    if (selection.result) return selection.result;
    return markSelectedFileViewed(selection.current);
  }

  async function focusNextUnviewedFile({ document: documentObject, href, signal, waitForRender = defaultWaitForRender } = {}) {
    if (signal && signal.aborted) return { status: "cancelled" };
    const selection = currentFileSelection(documentObject, href);
    if (selection.result) return selection.result;
    if (!selection.current.control) return resultFor("missing-controls", selection.current);
    return scanNextUnviewedFile({
      document: documentObject,
      files: selection.files,
      ...scannedThrough(selection.files, selection.current),
      signal,
      waitForRender
    });
  }

  async function markCurrentFileViewedAndFocusNext({
    document: documentObject,
    href,
    signal,
    waitAfterMark = defaultWaitAfterMark,
    waitForRender = defaultWaitForRender
  } = {}) {
    if (signal && signal.aborted) return { mark: { status: "cancelled" }, focus: null };
    const selection = currentFileSelection(documentObject, href);
    if (selection.result) return { mark: selection.result, focus: null };
    if (!selection.current.control || typeof selection.current.control.click !== "function") {
      return { mark: resultFor("missing-controls", selection.current), focus: null };
    }
    const scanned = scannedThrough(selection.files, selection.current);
    const mark = markSelectedFileViewed(selection.current);
    if (signal && signal.aborted) return { mark, focus: { status: "cancelled" } };
    if (typeof waitAfterMark === "function") {
      await waitAfterMark({ document: documentObject, mark, signal });
    }
    if (signal && signal.aborted) return { mark, focus: { status: "cancelled" } };
    const focus = await scanNextUnviewedFile({
      document: documentObject,
      files: exposedFiles(documentObject),
      ...scanned,
      signal,
      waitForRender
    });
    return { mark, focus };
  }

  return Object.freeze({
    focusNextUnviewedFile,
    markCurrentFileViewed,
    markCurrentFileViewedAndFocusNext,
    parsePullRequestFilesUrl,
    selectCurrentFile
  });
});
