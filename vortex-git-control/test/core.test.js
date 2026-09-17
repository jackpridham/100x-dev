const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

function keyEvent(key, overrides = {}) {
  let prevented = false;
  let stopped = false;
  return {
    key,
    target: { closest: () => null },
    preventDefault: () => { prevented = true; },
    stopImmediatePropagation: () => { stopped = true; },
    get prevented() { return prevented; },
    get stopped() { return stopped; },
    ...overrides
  };
}

test("ships the approved default sequences", () => {
  assert.deepEqual(core.defaultSettings().bindings, {
    olderIssue: ["v", "["],
    newerIssue: ["v", "]"],
    openIssues: ["v", "i"],
    openPullRequests: ["v", "p"],
    newIssue: ["v", "n"],
    refreshCache: ["v", "r"],
    goToNumber: ["v", "g"],
    markCurrentFileViewed: ["v", ";"],
    focusNextUnviewedFile: ["v", "'"]
  });
});

test("adds go-to-number without overwriting existing customized bindings", () => {
  const { goToNumber, ...bindings } = core.defaultSettings().bindings;
  assert.deepEqual(core.sanitizeSettings({ version: 4, bindings }).bindings.goToNumber, ["v", "g"]);
  bindings.openIssues = ["v", "g"];
  bindings.newIssue = [];
  const recovered = core.sanitizeSettings({ version: 4, bindings }).bindings;
  assert.deepEqual(recovered.goToNumber, []);
  assert.deepEqual(recovered.openIssues, ["v", "g"]);
  assert.deepEqual(recovered.newIssue, []);
});

test("v g invokes the number dialog action", () => {
  const actions = [];
  const matcher = new core.SequenceMatcher({ bindings: core.defaultSettings().bindings, onAction: id => actions.push(id) });
  matcher.handle(keyEvent("v"));
  matcher.handle(keyEvent("g"));
  assert.deepEqual(actions, ["goToNumber"]);
});

test("registers the next-unviewed-file action and default binding", () => {
  assert.deepEqual(core.ACTIONS.find(({ id }) => id === "focusNextUnviewedFile"), {
    id: "focusNextUnviewedFile",
    label: "Next unviewed file",
    defaults: ["v", "'"]
  });
});

test("adds the next-unviewed binding to existing version 3 settings", () => {
  const { focusNextUnviewedFile: _next, ...previousBindings } = core.defaultSettings().bindings;
  const migrated = core.sanitizeSettings({ version: 3, bindings: previousBindings });
  assert.deepEqual(migrated.bindings.focusNextUnviewedFile, ["v", "'"]);
  assert.equal(migrated.version, 4);
});

test("preserves existing bindings when the new default is already assigned", () => {
  const { focusNextUnviewedFile: _next, ...previousBindings } = core.defaultSettings().bindings;
  previousBindings.openIssues = ["v", "'"];
  previousBindings.newIssue = [];
  const migrated = core.sanitizeSettings({ version: 3, bindings: previousBindings });
  assert.deepEqual(migrated.bindings.openIssues, ["v", "'"]);
  assert.deepEqual(migrated.bindings.newIssue, []);
  assert.deepEqual(migrated.bindings.focusNextUnviewedFile, []);
});

test("matches a sequence and consumes both keystrokes", () => {
  const actions = [];
  let now = 0;
  const matcher = new core.SequenceMatcher({ bindings: core.defaultSettings().bindings, onAction: (id) => actions.push(id), now: () => now });
  const first = keyEvent("V");
  assert.equal(matcher.handle(first), true);
  assert.equal(first.prevented, true);
  now = 100;
  const second = keyEvent("[");
  assert.equal(matcher.handle(second), true);
  assert.deepEqual(actions, ["olderIssue"]);
});

test("times out, resets on mismatch, and permits a new prefix", () => {
  const actions = [];
  let now = 0;
  const matcher = new core.SequenceMatcher({ bindings: core.defaultSettings().bindings, onAction: (id) => actions.push(id), now: () => now });
  matcher.handle(keyEvent("v"));
  now = 1201;
  assert.equal(matcher.handle(keyEvent("i")), false);
  matcher.handle(keyEvent("v"));
  assert.equal(matcher.handle(keyEvent("x")), false);
  matcher.handle(keyEvent("v"));
  matcher.handle(keyEvent("p"));
  assert.deepEqual(actions, ["openPullRequests"]);
});

test("editable, composing, repeated, escaped, and modified input never triggers", () => {
  const actions = [];
  const matcher = new core.SequenceMatcher({ bindings: core.defaultSettings().bindings, onAction: (id) => actions.push(id) });
  const editable = { closest: () => ({ tagName: "TEXTAREA" }) };
  assert.equal(matcher.handle(keyEvent("v", { target: editable })), false);
  assert.equal(matcher.handle(keyEvent("v", {
    target: { closest: () => null },
    composedPath: () => [{ closest: () => ({ tagName: "INPUT" }) }]
  })), false);
  assert.equal(matcher.handle(keyEvent("v", { isComposing: true })), false);
  assert.equal(matcher.handle(keyEvent("v", { repeat: true })), false);
  assert.equal(matcher.handle(keyEvent("v", { ctrlKey: true })), false);
  matcher.handle(keyEvent("v"));
  matcher.handle(keyEvent("Escape"));
  matcher.handle(keyEvent("i"));
  assert.deepEqual(actions, []);
});

test("disabled bindings are ignored and duplicate bindings fail validation", () => {
  const settings = core.defaultSettings();
  settings.bindings.openIssues = [];
  const actions = [];
  const matcher = new core.SequenceMatcher({ bindings: settings.bindings, onAction: (id) => actions.push(id) });
  matcher.handle(keyEvent("v"));
  matcher.handle(keyEvent("i"));
  assert.deepEqual(actions, []);

  settings.bindings.newIssue = ["v", "p"];
  const validation = core.validateBindings(settings.bindings);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.newIssue, /already assigned/);
});

test("corrupt stored settings fall back while valid disabled actions survive", () => {
  const settings = core.sanitizeSettings({ bindings: { olderIssue: ["x"], newIssue: [] } });
  assert.deepEqual(settings.bindings.olderIssue, ["v", "["]);
  assert.deepEqual(settings.bindings.newIssue, []);
  assert.deepEqual(settings.bindings.newerIssue, ["v", "]"]);
});

test("migrates the former test-file action without replacing custom choices", () => {
  const { markCurrentFileViewed: _current, ...legacyBindings } = core.defaultSettings().bindings;
  const oldDefaults = {
    ...core.defaultSettings(),
    version: 1,
    bindings: { ...legacyBindings, markTestsViewed: ["v", "t"] }
  };
  assert.deepEqual(core.sanitizeSettings(oldDefaults).bindings.markCurrentFileViewed, ["v", ";"]);

  const customized = {
    ...oldDefaults,
    bindings: { ...oldDefaults.bindings, markTestsViewed: ["x", "m"] }
  };
  assert.deepEqual(core.sanitizeSettings(customized).bindings.markCurrentFileViewed, ["x", "m"]);

  const disabled = {
    ...oldDefaults,
    bindings: { ...oldDefaults.bindings, markTestsViewed: [] }
  };
  assert.deepEqual(core.sanitizeSettings(disabled).bindings.markCurrentFileViewed, []);
});

test("token normalization accepts one printable Unicode character only", () => {
  assert.equal(core.normalizeToken("A"), "a");
  assert.equal(core.normalizeToken("["), "[");
  assert.equal(core.normalizeToken("🌀"), "🌀");
  assert.equal(core.normalizeToken("İ"), "İ");
  assert.equal(core.normalizeToken(" "), null);
  assert.equal(core.normalizeToken("\u0007"), null);
  assert.equal(core.normalizeToken("\u200b"), null);
  assert.equal(core.normalizeToken("ab"), null);
});
