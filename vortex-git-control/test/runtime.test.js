const test = require("node:test");
const assert = require("node:assert/strict");
const runtime = require("../src/runtime.js");

const context = { owner: "acme", repo: "widgets" };

test("number dialog routes issue and PR lists, detail pages, and review tabs", () => {
  for (const path of ["issues", "issues/12", "issues?q=is%3Aopen"]) {
    assert.equal(runtime.numberedPageBase(`https://github.com/acme/widgets/${path}`), "https://github.com/acme/widgets/issues/");
  }
  for (const path of ["pulls", "pull/12", "pull/12/files", "pull/12/changes", "pull/12/commits"]) {
    assert.equal(runtime.numberedPageBase(`https://github.com/acme/widgets/${path}`), "https://github.com/acme/widgets/pull/");
  }
  for (const path of ["", "issues", "acme/widgets", "acme/widgets/pulls-other"]) {
    assert.equal(runtime.numberedPageBase(`https://github.com/${path}`), null);
  }
  assert.equal(runtime.numberedPageBase("https://example.com/acme/widgets/issues"), null);
});

test("builds same-tab repository destinations for all direct actions", () => {
  assert.equal(runtime.repositoryActionUrl(context, "newIssue"), "https://github.com/acme/widgets/issues/new/choose");
  assert.equal(new URL(runtime.repositoryActionUrl(context, "openIssues")).searchParams.get("q"), "is:issue state:open sort:created-asc");
  assert.equal(new URL(runtime.repositoryActionUrl(context, "openPullRequests")).searchParams.get("q"), "is:pr is:open");
  assert.equal(runtime.repositoryActionUrl(null, "newIssue"), null);
});

test("maps adapter failure codes to useful user-facing feedback", () => {
  assert.equal(runtime.errorMessage({ code: "NOT_ISSUE" }), "This is not an individual issue page.");
  assert.match(runtime.errorMessage({ code: "ANCHOR_MISSING" }), /creation time/);
  assert.match(runtime.errorMessage({ code: "SEARCH_FAILED" }), /could not be loaded/);
  assert.match(runtime.errorMessage({ code: "UNEXPECTED_SEARCH_PAGE" }), /unexpected search page/);
  assert.match(runtime.errorMessage(new Error("unknown")), /could not complete/);
});

test("navigation gate aborts and invalidates work from the previous soft-navigation page", () => {
  const gate = new runtime.NavigationGate();
  const first = gate.begin();
  assert.equal(gate.isCurrent(first), true);
  assert.equal(gate.begin(), null);
  gate.invalidate();
  assert.equal(first.controller.signal.aborted, true);
  assert.equal(gate.isCurrent(first), false);
  const second = gate.begin();
  assert.notEqual(second, null);
  assert.equal(gate.isCurrent(second), true);
  gate.finish(second);
  assert.notEqual(gate.begin(), null);
});

test("lifecycle wiring resets prefixes on focus and invalidates on soft navigation", () => {
  const listeners = {};
  const target = { addEventListener: (name, handler) => { listeners[name] = handler; } };
  let resets = 0;
  let invalidations = 0;
  runtime.wireLifecycle(target, { reset: () => { resets += 1; } }, () => { invalidations += 1; });
  listeners.focusin();
  listeners.blur();
  assert.equal(resets, 2);
  assert.equal(invalidations, 0);
  listeners["turbo:load"]();
  assert.equal(resets, 3);
  assert.equal(invalidations, 1);
});
