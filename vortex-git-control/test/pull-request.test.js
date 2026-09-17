const test = require("node:test");
const assert = require("node:assert/strict");
const pullRequest = require("../src/pull-request.js");

function element({ attrs = {}, children = [], parent = null, query = {}, rect = null, order = null } = {}) {
  const node = {
    parentElement: parent,
    children,
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    querySelector(selector) {
      const result = query[selector];
      return Array.isArray(result) ? result[0] || null : result || null;
    },
    querySelectorAll(selector) {
      const result = query[selector];
      return Array.isArray(result) ? result : result ? [result] : [];
    },
    contains(candidate) {
      let current = candidate;
      while (current) {
        if (current === this) return true;
        current = current.parentElement;
      }
      return false;
    },
    getBoundingClientRect() { return rect; },
    compareDocumentPosition(other) {
      if (!Number.isFinite(this.documentOrder) || !Number.isFinite(other && other.documentOrder)) return 0;
      return this.documentOrder < other.documentOrder ? 4 : this.documentOrder > other.documentOrder ? 2 : 0;
    },
    documentOrder: order,
    click() { this.clicked = (this.clicked || 0) + 1; },
    scrollIntoView(options) { this.scrollOptions = options; }
  };
  for (const child of children) child.parentElement = node;
  return node;
}

function currentEntry(path, { viewed = false, rect = { top: 0, bottom: 500 }, headerRect = null } = {}) {
  const label = element({ attrs: { "data-component": "text" } });
  label.textContent = "Viewed";
  const button = element({ attrs: {
    "data-component": "Button",
    "aria-pressed": viewed ? "true" : "false",
    "aria-label": viewed ? "Viewed" : "Not Viewed"
  }, query: { '[data-component="text"]': label } });
  const child = element();
  const header = headerRect ? element({
    attrs: { "data-diff-header-wrapper": "true" },
    rect: headerRect
  }) : null;
  const entry = element({
    attrs: { "data-file-path": path },
    children: [child, button, ...(header ? [header] : [])],
    query: {
      button: [button],
      '[data-diff-header-wrapper="true"]': header ? [header] : []
    },
    rect
  });
  return { button, child, entry, header };
}

function shellEntry(path, { rect = { top: 710, bottom: 1000 } } = {}) {
  const entry = element({
    attrs: { "data-file-path": path },
    query: { button: [] },
    rect
  });
  return { entry };
}

function documentFor(entries, { activeElement = null, pointElement = null, scrollHeight = 800, scrollY = 0 } = {}) {
  const scrollingElement = { scrollHeight, scrollTop: scrollY };
  const defaultView = {
    innerWidth: 1200,
    innerHeight: 800,
    get scrollY() { return scrollingElement.scrollTop; },
    scrollTo(options) {
      this.scrollCalls = [...(this.scrollCalls || []), options];
      scrollingElement.scrollTop = options.top;
    }
  };
  return {
    activeElement,
    defaultView,
    scrollingElement,
    querySelectorAll(selector) {
      if (selector === "copilot-diff-entry[data-file-path]") return entries.map(({ entry }) => entry);
      if (selector === "button") return entries.flatMap(({ entry }) => entry.querySelectorAll("button"));
      if (selector === '[data-diff-header-wrapper="true"]') {
        return entries.flatMap(({ entry }) => entry.querySelectorAll('[data-diff-header-wrapper="true"]'));
      }
      return [];
    },
    elementFromPoint() { return pointElement; }
  };
}

test("uses GitHub's topmost visible sticky filename header", async () => {
  const sticky = currentEntry("src/sticky.js", {
    rect: { top: -400, bottom: 650 },
    headerRect: { top: 82, bottom: 146 }
  });
  const centered = currentEntry("src/centered.js", {
    rect: { top: 650, bottom: 1000 },
    headerRect: { top: 650, bottom: 714 }
  });
  const result = await pullRequest.markCurrentFileViewed({
    document: documentFor([sticky, centered], { pointElement: centered.child }),
    href: "https://github.com/acme/widgets/pull/42/changes"
  });
  assert.deepEqual(result, { status: "success", path: "src/sticky.js" });
  assert.equal(sticky.button.clicked, 1);
  assert.equal(centered.button.clicked, undefined);
});

test("accepts both pull request Files changed URL forms", () => {
  assert.deepEqual(pullRequest.parsePullRequestFilesUrl("https://github.com/acme/widgets/pull/42/files"), {
    owner: "acme", repo: "widgets", number: 42
  });
  assert.deepEqual(pullRequest.parsePullRequestFilesUrl("https://github.com/acme/widgets/pull/42/changes?x=1"), {
    owner: "acme", repo: "widgets", number: 42
  });
  assert.equal(pullRequest.parsePullRequestFilesUrl("https://github.com/acme/widgets/pull/42"), null);
});

test("marks the focused file before other visible files", async () => {
  const first = currentEntry("src/production.js", { rect: { top: 100, bottom: 700 } });
  const focused = currentEntry("tests/focused.js", { rect: { top: 200, bottom: 500 } });
  const result = await pullRequest.markCurrentFileViewed({
    document: documentFor([first, focused], { activeElement: focused.child, pointElement: first.child }),
    href: "https://github.com/acme/widgets/pull/42/changes"
  });
  assert.deepEqual(result, { status: "success", path: "tests/focused.js" });
  assert.equal(focused.button.clicked, 1);
  assert.equal(first.button.clicked, undefined);
});

test("uses the file under the viewport center when focus is outside the diffs", async () => {
  const center = currentEntry("src/current.js", { rect: { top: 100, bottom: 700 } });
  const other = currentEntry("src/other.js", { rect: { top: 710, bottom: 780 } });
  const result = await pullRequest.markCurrentFileViewed({
    document: documentFor([center, other], { activeElement: element(), pointElement: center.child }),
    href: "https://github.com/acme/widgets/pull/42/files"
  });
  assert.equal(result.path, "src/current.js");
  assert.equal(center.button.clicked, 1);
  assert.equal(other.button.clicked, undefined);
});

test("falls back to the most-visible file", async () => {
  const sliver = currentEntry("src/sliver.js", { rect: { top: -500, bottom: 50 } });
  const visible = currentEntry("src/visible.js", { rect: { top: 100, bottom: 700 } });
  const result = await pullRequest.markCurrentFileViewed({
    document: documentFor([sliver, visible]),
    href: "https://github.com/acme/widgets/pull/42/changes"
  });
  assert.equal(result.path, "src/visible.js");
  assert.equal(visible.button.clicked, 1);
  assert.equal(sliver.button.clicked, undefined);
});

test("does not toggle the current file when it is already viewed", async () => {
  const viewed = currentEntry("src/viewed.js", { viewed: true });
  const result = await pullRequest.markCurrentFileViewed({
    document: documentFor([viewed], { pointElement: viewed.child }),
    href: "https://github.com/acme/widgets/pull/42/files"
  });
  assert.deepEqual(result, { status: "already-viewed", path: "src/viewed.js" });
  assert.equal(viewed.button.clicked, undefined);
});

test("supports GitHub's virtualized diff regions", async () => {
  const label = element({ attrs: { "data-component": "text" } });
  label.textContent = "Viewed";
  const button = element({ attrs: { "aria-pressed": "false", "aria-label": "Not Viewed" }, query: {
    '[data-component="text"]': label
  }});
  const child = element();
  const expandAll = element({ attrs: { "aria-label": "Expand all lines: api/src/Config.php" } });
  const region = element({ attrs: { role: "region", id: "diff-695dadf" }, children: [child, button], query: {
    button: [button],
    "[aria-label]": [button, expandAll]
  }, rect: { top: 50, bottom: 750 } });
  const documentObject = {
    activeElement: null,
    defaultView: { innerWidth: 1200, innerHeight: 800 },
    querySelectorAll(selector) { return selector === "button" ? [button] : []; },
    elementFromPoint() { return child; }
  };
  const result = await pullRequest.markCurrentFileViewed({
    document: documentObject,
    href: "https://github.com/acme/widgets/pull/42/changes"
  });
  assert.equal(region.getAttribute("role"), "region");
  assert.deepEqual(result, { status: "success", path: "api/src/Config.php" });
  assert.equal(button.clicked, 1);
});

test("marks a virtualized diff even when GitHub omits filename metadata", async () => {
  const label = element({ attrs: { "data-component": "text" } });
  label.textContent = "Viewed";
  const button = element({ attrs: { "aria-pressed": "false", "aria-label": "Not Viewed" }, query: {
    '[data-component="text"]': label
  }});
  const child = element();
  const header = element({
    attrs: { "data-diff-header-wrapper": "true" },
    rect: { top: 82, bottom: 146 }
  });
  const region = element({
    attrs: { role: "region", id: "diff-without-expand-control" },
    children: [child, header, button],
    query: { button: [button] },
    rect: { top: -300, bottom: 700 }
  });
  const documentObject = {
    activeElement: null,
    defaultView: { innerWidth: 1200, innerHeight: 800 },
    querySelectorAll(selector) {
      if (selector === "button") return [button];
      if (selector === '[data-diff-header-wrapper="true"]') return [header];
      return [];
    },
    elementFromPoint() { return child; }
  };
  const result = await pullRequest.markCurrentFileViewed({
    document: documentObject,
    href: "https://github.com/acme/widgets/pull/42/changes"
  });
  assert.equal(region.getAttribute("id"), "diff-without-expand-control");
  assert.deepEqual(result, { status: "success" });
  assert.equal(button.clicked, 1);
});

test("supports GitHub's legacy Viewed checkbox", async () => {
  const child = element();
  const checkbox = element({ attrs: { type: "checkbox", name: "viewed" } });
  checkbox.checked = false;
  const header = element({
    attrs: { "data-path": "src/legacy.js" },
    children: [child, checkbox],
    rect: { top: 100, bottom: 180 }
  });
  const documentObject = {
    activeElement: null,
    defaultView: { innerWidth: 1200, innerHeight: 800 },
    querySelectorAll(selector) {
      return selector === 'input[type="checkbox"][name="viewed"]' ? [checkbox] : [];
    },
    elementFromPoint() { return child; }
  };
  const result = await pullRequest.markCurrentFileViewed({
    document: documentObject,
    href: "https://github.com/acme/widgets/pull/42/files"
  });
  assert.equal(header.getAttribute("data-path"), "src/legacy.js");
  assert.deepEqual(result, { status: "success", path: "src/legacy.js" });
  assert.equal(checkbox.clicked, 1);
});

test("reports wrong pages, missing controls, and no visible current file", async () => {
  assert.deepEqual(await pullRequest.markCurrentFileViewed({
    document: documentFor([]), href: "https://github.com/acme/widgets/pull/42"
  }), { status: "wrong-page" });
  assert.deepEqual(await pullRequest.markCurrentFileViewed({
    document: documentFor([]), href: "https://github.com/acme/widgets/pull/42/files"
  }), { status: "missing-controls" });
  const offscreen = currentEntry("src/offscreen.js", { rect: { top: 900, bottom: 1200 } });
  assert.deepEqual(await pullRequest.markCurrentFileViewed({
    document: documentFor([offscreen]), href: "https://github.com/acme/widgets/pull/42/files"
  }), { status: "no-current-file" });
});

test("marks the current file and focuses the first later unviewed file", async () => {
  const current = currentEntry("src/current.js", { rect: { top: 100, bottom: 700 } });
  const next = currentEntry("src/next.js", {
    rect: { top: 910, bottom: 1200 },
    headerRect: { top: 910, bottom: 974 }
  });

  const result = await pullRequest.markCurrentFileViewedAndFocusNext({
    document: documentFor([current, next], { pointElement: current.child }),
    href: "https://github.com/acme/widgets/pull/42/files",
    waitAfterMark() {}
  });

  assert.deepEqual(result, {
    mark: { status: "success", path: "src/current.js" },
    focus: { status: "success", path: "src/next.js" }
  });
  assert.equal(current.button.clicked, 1);
  assert.deepEqual(next.header.scrollOptions, { block: "start", behavior: "smooth" });
  assert.equal(next.button.clicked, undefined);
});

test("keeps the pre-click anchor when marking collapses the current diff", async () => {
  const current = currentEntry("src/current.js", { rect: { top: 100, bottom: 700 } });
  const next = currentEntry("src/next.js", {
    rect: { top: 910, bottom: 1200 },
    headerRect: { top: 910, bottom: 974 }
  });
  const entries = [current, next];
  let collapsed = false;
  next.header.getBoundingClientRect = () => collapsed
    ? { top: 82, bottom: 146 }
    : { top: 910, bottom: 974 };
  current.button.click = function clickAndCollapseCurrent() {
    this.clicked = (this.clicked || 0) + 1;
    collapsed = true;
    entries.splice(0, entries.length, next);
  };

  const result = await pullRequest.markCurrentFileViewedAndFocusNext({
    document: documentFor(entries, { pointElement: current.child }),
    href: "https://github.com/acme/widgets/pull/42/changes",
    waitAfterMark() {}
  });

  assert.deepEqual(result, {
    mark: { status: "success", path: "src/current.js" },
    focus: { status: "success", path: "src/next.js" }
  });
  assert.equal(current.button.clicked, 1);
  assert.deepEqual(next.header.scrollOptions, { block: "start", behavior: "smooth" });
  assert.equal(next.button.clicked, undefined);
});

test("advances lazily when the current file is already viewed", async () => {
  const current = currentEntry("src/current.js", { viewed: true, rect: { top: 100, bottom: 700 } });
  const viewed = currentEntry("src/viewed.js", { viewed: true, rect: { top: 710, bottom: 1000 } });
  const remountedViewed = currentEntry("src/viewed.js", { viewed: true, rect: { top: 100, bottom: 500 } });
  const next = currentEntry("src/lazy-next.js", {
    rect: { top: 510, bottom: 900 },
    headerRect: { top: 510, bottom: 574 }
  });
  const entries = [current, viewed];
  const documentObject = documentFor(entries, {
    pointElement: current.child,
    scrollHeight: 3200
  });
  let renderWaits = 0;

  const result = await pullRequest.markCurrentFileViewedAndFocusNext({
    document: documentObject,
    href: "https://github.com/acme/widgets/pull/42/changes",
    waitAfterMark() {},
    waitForRender() {
      renderWaits += 1;
      entries.splice(0, entries.length, remountedViewed, next);
    }
  });

  assert.deepEqual(result, {
    mark: { status: "already-viewed", path: "src/current.js" },
    focus: { status: "success", path: "src/lazy-next.js" }
  });
  assert.equal(renderWaits, 1);
  assert.equal(current.button.clicked, undefined);
  assert.deepEqual(next.header.scrollOptions, { block: "start", behavior: "smooth" });
  assert.equal(next.button.clicked, undefined);
});

test("does not focus another file when marking the current file fails", async () => {
  const current = currentEntry("src/current.js", { rect: { top: 100, bottom: 700 } });
  const next = currentEntry("src/next.js", {
    rect: { top: 710, bottom: 1000 },
    headerRect: { top: 710, bottom: 774 }
  });
  let renderWaits = 0;

  const result = await pullRequest.markCurrentFileViewedAndFocusNext({
    document: documentFor([current, next], { pointElement: current.child, scrollHeight: 3200 }),
    href: "https://github.com/acme/widgets/pull/42",
    waitAfterMark() { throw new Error("mark failures must not settle or advance"); },
    waitForRender() { renderWaits += 1; }
  });

  assert.deepEqual(result, { mark: { status: "wrong-page" }, focus: null });
  assert.equal(renderWaits, 0);
  assert.equal(current.button.clicked, undefined);
  assert.equal(next.header.scrollOptions, undefined);
});

test("cancels mark-and-advance before focusing a soft-navigation destination", async () => {
  const current = currentEntry("src/pr-a-current.js", { rect: { top: 100, bottom: 700 } });
  const viewed = currentEntry("src/pr-a-viewed.js", { viewed: true, rect: { top: 710, bottom: 1000 } });
  const otherPullRequestFile = currentEntry("src/pr-b-unviewed.js", {
    rect: { top: 100, bottom: 700 },
    headerRect: { top: 100, bottom: 164 }
  });
  const entries = [current, viewed];
  const documentObject = documentFor(entries, {
    pointElement: current.child,
    scrollHeight: 3200
  });
  const controller = new AbortController();

  const result = await pullRequest.markCurrentFileViewedAndFocusNext({
    document: documentObject,
    href: "https://github.com/acme/widgets/pull/42/changes",
    signal: controller.signal,
    waitAfterMark() {
      controller.abort();
      entries.splice(0, entries.length, otherPullRequestFile);
    }
  });

  assert.deepEqual(result, {
    mark: { status: "success", path: "src/pr-a-current.js" },
    focus: { status: "cancelled" }
  });
  assert.equal(current.button.clicked, 1);
  assert.equal(otherPullRequestFile.header.scrollOptions, undefined);
  assert.equal(otherPullRequestFile.button.clicked, undefined);
});

test("waits for post-mark settlement before focusing the next file", async () => {
  const current = currentEntry("src/current.js", { viewed: true, rect: { top: 100, bottom: 700 } });
  const next = currentEntry("src/next.js", {
    rect: { top: 910, bottom: 1200 },
    headerRect: { top: 910, bottom: 974 }
  });
  let settle;
  const settlement = new Promise((resolve) => { settle = resolve; });

  const operation = pullRequest.markCurrentFileViewedAndFocusNext({
    document: documentFor([current, next], { pointElement: current.child }),
    href: "https://github.com/acme/widgets/pull/42/files",
    waitAfterMark() { return settlement; }
  });

  await Promise.resolve();
  assert.equal(next.header.scrollOptions, undefined);
  settle();
  const result = await operation;
  assert.deepEqual(result, {
    mark: { status: "already-viewed", path: "src/current.js" },
    focus: { status: "success", path: "src/next.js" }
  });
  assert.deepEqual(next.header.scrollOptions, { block: "start", behavior: "smooth" });
  assert.equal(next.button.clicked, undefined);
});

test("focuses the first later unviewed header without clicking it", async () => {
  const current = currentEntry("src/current.js", { rect: { top: 100, bottom: 700 } });
  const viewed = currentEntry("src/viewed.js", { viewed: true, rect: { top: 710, bottom: 900 } });
  const next = currentEntry("src/next.js", { rect: { top: 910, bottom: 1100 }, headerRect: { top: 910, bottom: 974 } });
  const result = await pullRequest.focusNextUnviewedFile({
    document: documentFor([current, viewed, next], { pointElement: current.child }),
    href: "https://github.com/acme/widgets/pull/42/files"
  });
  assert.deepEqual(result, { status: "success", path: "src/next.js" });
  assert.deepEqual(next.header.scrollOptions, { block: "start", behavior: "smooth" });
  assert.equal(next.button.clicked, undefined);
  assert.equal(viewed.button.clicked, undefined);
});

test("advances a virtualized diff list until a later unviewed file is mounted", async () => {
  const current = currentEntry("src/current.js", { rect: { top: 100, bottom: 700 } });
  const viewed = currentEntry("src/viewed.js", { viewed: true, rect: { top: 710, bottom: 1000 } });
  const remountedViewed = currentEntry("src/viewed.js", { viewed: true, rect: { top: 100, bottom: 500 } });
  const next = currentEntry("src/lazy-next.js", {
    rect: { top: 720, bottom: 1100 },
    headerRect: { top: 720, bottom: 784 }
  });
  const entries = [current, viewed];
  const documentObject = documentFor(entries, {
    pointElement: current.child,
    scrollHeight: 3200
  });
  let renderWaits = 0;

  const result = await pullRequest.focusNextUnviewedFile({
    document: documentObject,
    href: "https://github.com/acme/widgets/pull/42/changes",
    waitForRender() {
      renderWaits += 1;
      entries.splice(0, entries.length, remountedViewed, next);
    }
  });

  assert.deepEqual(result, { status: "success", path: "src/lazy-next.js" });
  assert.equal(renderWaits, 1);
  assert.ok(documentObject.defaultView.scrollCalls[0].top >= 800);
  assert.deepEqual(documentObject.defaultView.scrollCalls[0], {
    top: documentObject.defaultView.scrollCalls[0].top,
    behavior: "auto"
  });
  assert.deepEqual(next.header.scrollOptions, { block: "start", behavior: "smooth" });
  assert.equal(current.button.clicked, undefined);
  assert.equal(viewed.button.clicked, undefined);
  assert.equal(remountedViewed.button.clicked, undefined);
  assert.equal(next.button.clicked, undefined);
});

test("cancels before rescanning files mounted by a soft-navigation destination", async () => {
  const current = currentEntry("src/pr-a-current.js", { rect: { top: 100, bottom: 700 } });
  const viewed = currentEntry("src/pr-a-viewed.js", { viewed: true, rect: { top: 710, bottom: 1000 } });
  const otherPullRequestFile = currentEntry("src/pr-b-unviewed.js", {
    rect: { top: 100, bottom: 700 },
    headerRect: { top: 100, bottom: 164 }
  });
  const entries = [current, viewed];
  const documentObject = documentFor(entries, {
    pointElement: current.child,
    scrollHeight: 3200
  });
  const controller = new AbortController();

  const result = await pullRequest.focusNextUnviewedFile({
    document: documentObject,
    href: "https://github.com/acme/widgets/pull/42/changes",
    signal: controller.signal,
    waitForRender() {
      controller.abort();
      entries.splice(0, entries.length, otherPullRequestFile);
    }
  });

  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(otherPullRequestFile.header.scrollOptions, undefined);
  assert.equal(otherPullRequestFile.button.clicked, undefined);
});

test("waits for the first later control-less shell to finish mounting", async () => {
  const current = currentEntry("src/current.js", { rect: { top: 100, bottom: 700 } });
  const pending = shellEntry("src/pending.js");
  const resolved = currentEntry("src/pending.js", {
    rect: { top: 100, bottom: 700 },
    headerRect: { top: 100, bottom: 164 }
  });
  const later = currentEntry("src/later.js", {
    rect: { top: 1010, bottom: 1300 },
    headerRect: { top: 1010, bottom: 1074 }
  });
  const entries = [current, pending, later];
  const documentObject = documentFor(entries, {
    pointElement: current.child,
    scrollHeight: 3200
  });
  let renderWaits = 0;

  const result = await pullRequest.focusNextUnviewedFile({
    document: documentObject,
    href: "https://github.com/acme/widgets/pull/42/files",
    waitForRender() {
      renderWaits += 1;
      entries.splice(0, entries.length, resolved, later);
    }
  });

  assert.deepEqual(result, { status: "success", path: "src/pending.js" });
  assert.equal(renderWaits, 1);
  assert.deepEqual(documentObject.defaultView.scrollCalls[0], { top: 710, behavior: "auto" });
  assert.deepEqual(resolved.header.scrollOptions, { block: "start", behavior: "smooth" });
  assert.equal(later.header.scrollOptions, undefined);
  assert.equal(current.button.clicked, undefined);
  assert.equal(resolved.button.clicked, undefined);
  assert.equal(later.button.clicked, undefined);
});

test("keeps bounded render waits when a pending shell is already at its scroll target", async () => {
  const current = currentEntry("src/current.js", { rect: { top: -500, bottom: 0 } });
  const pending = shellEntry("src/pending.js", { rect: { top: 0, bottom: 400 } });
  const resolved = currentEntry("src/pending.js", {
    rect: { top: 0, bottom: 400 },
    headerRect: { top: 0, bottom: 64 }
  });
  const entries = [current, pending];
  const documentObject = documentFor(entries, {
    activeElement: current.child,
    scrollHeight: 3200,
    scrollY: 800
  });
  let renderWaits = 0;

  const result = await pullRequest.focusNextUnviewedFile({
    document: documentObject,
    href: "https://github.com/acme/widgets/pull/42/changes",
    waitForRender() {
      renderWaits += 1;
      if (renderWaits === 2) entries.splice(0, entries.length, resolved);
    }
  });

  assert.deepEqual(result, { status: "success", path: "src/pending.js" });
  assert.equal(renderWaits, 2);
  assert.equal(documentObject.defaultView.scrollCalls, undefined);
  assert.deepEqual(resolved.header.scrollOptions, { block: "start", behavior: "smooth" });
});

test("stops bounded virtualized scanning at the document end", async () => {
  const current = currentEntry("src/current.js", { rect: { top: 100, bottom: 700 } });
  const viewed = currentEntry("src/viewed.js", { viewed: true, rect: { top: 710, bottom: 1000 } });
  const documentObject = documentFor([current, viewed], {
    pointElement: current.child,
    scrollHeight: 2400
  });
  let renderWaits = 0;

  const result = await pullRequest.focusNextUnviewedFile({
    document: documentObject,
    href: "https://github.com/acme/widgets/pull/42/files",
    waitForRender() { renderWaits += 1; }
  });

  assert.deepEqual(result, { status: "no-next-unviewed" });
  assert.equal(documentObject.scrollingElement.scrollTop, 1600);
  assert.equal(documentObject.defaultView.scrollCalls.at(-1).top, 1600);
  assert.ok(renderWaits > 0);
  assert.ok(renderWaits < 10);
  assert.equal(current.button.clicked, undefined);
  assert.equal(viewed.button.clicked, undefined);
});

test("keeps mixed GitHub file shapes in document order", async () => {
  const currentLabel = element({ attrs: { "data-component": "text" } });
  currentLabel.textContent = "Viewed";
  const currentButton = element({ attrs: { "aria-pressed": "false", "aria-label": "Not Viewed" }, query: {
    '[data-component="text"]': currentLabel
  }});
  const currentHeader = element({ attrs: { "data-diff-header-wrapper": "true" }, rect: { top: 82, bottom: 146 } });
  const currentRegion = element({
    attrs: { role: "region", id: "diff-current" },
    children: [currentHeader, currentButton],
    query: { button: [currentButton] },
    rect: { top: -200, bottom: 700 },
    order: 1
  });
  const later = currentEntry("src/later.js", {
    rect: { top: 710, bottom: 900 },
    headerRect: { top: 710, bottom: 774 }
  });
  later.entry.documentOrder = 2;
  const documentObject = {
    activeElement: null,
    defaultView: { innerWidth: 1200, innerHeight: 800 },
    querySelectorAll(selector) {
      if (selector === "copilot-diff-entry[data-file-path]") return [later.entry];
      if (selector === "button") return [currentButton, later.button];
      if (selector === '[data-diff-header-wrapper="true"]') return [currentHeader, later.header];
      return [];
    },
    elementFromPoint() { return currentHeader; }
  };
  const result = await pullRequest.focusNextUnviewedFile({
    document: documentObject,
    href: "https://github.com/acme/widgets/pull/42/changes"
  });
  assert.equal(currentRegion.getAttribute("id"), "diff-current");
  assert.deepEqual(result, { status: "success", path: "src/later.js" });
  assert.deepEqual(later.header.scrollOptions, { block: "start", behavior: "smooth" });
});

test("falls back to the later file container when it has no header", async () => {
  const current = currentEntry("src/current.js", { rect: { top: 100, bottom: 700 } });
  const next = currentEntry("src/next.js", { rect: { top: 710, bottom: 900 } });
  const result = await pullRequest.focusNextUnviewedFile({
    document: documentFor([current, next], { pointElement: current.child }),
    href: "https://github.com/acme/widgets/pull/42/changes"
  });
  assert.deepEqual(result, { status: "success", path: "src/next.js" });
  assert.deepEqual(next.entry.scrollOptions, { block: "start", behavior: "smooth" });
  assert.equal(next.button.clicked, undefined);
});

test("does not wrap when no later unviewed file exists", async () => {
  const current = currentEntry("src/current.js", { rect: { top: 100, bottom: 700 } });
  const viewed = currentEntry("src/viewed.js", { viewed: true, rect: { top: 710, bottom: 900 } });
  const result = await pullRequest.focusNextUnviewedFile({
    document: documentFor([current, viewed], { pointElement: current.child }),
    href: "https://github.com/acme/widgets/pull/42/files"
  });
  assert.deepEqual(result, { status: "no-next-unviewed" });
  assert.equal(current.entry.scrollOptions, undefined);
  assert.equal(viewed.entry.scrollOptions, undefined);
});

test("keeps next-unviewed status distinctions for page and controls", async () => {
  assert.deepEqual(await pullRequest.focusNextUnviewedFile({
    document: documentFor([]), href: "https://github.com/acme/widgets/pull/42"
  }), { status: "wrong-page" });
  assert.deepEqual(await pullRequest.focusNextUnviewedFile({
    document: documentFor([]), href: "https://github.com/acme/widgets/pull/42/files"
  }), { status: "missing-controls" });
  const offscreen = currentEntry("src/offscreen.js", { rect: { top: 900, bottom: 1200 } });
  assert.deepEqual(await pullRequest.focusNextUnviewedFile({
    document: documentFor([offscreen]), href: "https://github.com/acme/widgets/pull/42/files"
  }), { status: "no-current-file" });
});
