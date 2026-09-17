(function exposeVortexCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VortexGitControlCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createVortexCore() {
  "use strict";

  const SETTINGS_VERSION = 4;
  const SEQUENCE_TIMEOUT_MS = 1200;
  const ACTIONS = Object.freeze([
    Object.freeze({ id: "olderIssue", label: "Older open issue", defaults: Object.freeze(["v", "["]) }),
    Object.freeze({ id: "newerIssue", label: "Newer open issue", defaults: Object.freeze(["v", "]"]) }),
    Object.freeze({ id: "openIssues", label: "Open issues", defaults: Object.freeze(["v", "i"]) }),
    Object.freeze({ id: "openPullRequests", label: "Open pull requests", defaults: Object.freeze(["v", "p"]) }),
    Object.freeze({ id: "newIssue", label: "New issue", defaults: Object.freeze(["v", "n"]) }),
    Object.freeze({ id: "refreshCache", label: "Refresh issue cache", defaults: Object.freeze(["v", "r"]) }),
    Object.freeze({ id: "goToNumber", label: "Go to issue or pull request number", defaults: Object.freeze(["v", "g"]) }),
    Object.freeze({ id: "markCurrentFileViewed", label: "Mark current file viewed", defaults: Object.freeze(["v", ";"]) }),
    Object.freeze({ id: "focusNextUnviewedFile", label: "Next unviewed file", defaults: Object.freeze(["v", "'"]) })
  ]);

  function defaultSettings() {
    return {
      version: SETTINGS_VERSION,
      bindings: Object.fromEntries(ACTIONS.map((action) => [action.id, [...action.defaults]]))
    };
  }

  function normalizeToken(value) {
    if (typeof value !== "string") return null;
    const token = value.trim();
    if (Array.from(token).length !== 1 || /[\p{C}\p{Z}]/u.test(token)) return null;
    return /^[A-Z]$/u.test(token) ? token.toLowerCase() : token;
  }

  function normalizeSequence(value) {
    if (!Array.isArray(value)) return null;
    if (value.length === 0) return [];
    if (value.length !== 2) return null;
    const normalized = value.map(normalizeToken);
    return normalized.every(Boolean) ? normalized : null;
  }

  function validateBindings(bindings) {
    const errors = {};
    const seen = new Map();

    for (const action of ACTIONS) {
      const sequence = normalizeSequence(bindings && bindings[action.id]);
      if (sequence === null) {
        errors[action.id] = "Choose exactly two printable, non-space keys.";
        continue;
      }
      if (sequence.length === 0) continue;
      const signature = sequence.join("\u0000");
      if (seen.has(signature)) {
        const otherId = seen.get(signature);
        errors[action.id] = "This sequence is already assigned.";
        errors[otherId] = "This sequence is already assigned.";
      } else {
        seen.set(signature, action.id);
      }
    }

    return { valid: Object.keys(errors).length === 0, errors };
  }

  function sanitizeSettings(value) {
    const defaults = defaultSettings();
    if (!value || typeof value !== "object") return defaults;
    const nextBindingWasMissing = !value.bindings || !Object.prototype.hasOwnProperty.call(value.bindings, "focusNextUnviewedFile");

    const bindings = {};
    for (const action of ACTIONS) {
      let stored = value.bindings && value.bindings[action.id];
      if (action.id === "markCurrentFileViewed" && stored === undefined) stored = value.bindings && value.bindings.markTestsViewed;
      const normalized = normalizeSequence(stored);
      bindings[action.id] = normalized === null ? [...defaults.bindings[action.id]] : normalized;
    }

    if (value.version !== SETTINGS_VERSION && bindings.markCurrentFileViewed.join("\u0000") === "v\u0000t") {
      bindings.markCurrentFileViewed = [...defaults.bindings.markCurrentFileViewed];
    }

    if (nextBindingWasMissing) {
      const nextSignature = bindings.focusNextUnviewedFile.join("\u0000");
      const conflictsWithExisting = ACTIONS.some(({ id }) => id !== "focusNextUnviewedFile" && bindings[id].join("\u0000") === nextSignature);
      if (conflictsWithExisting) bindings.focusNextUnviewedFile = [];
    }

    if (!value.bindings || !Object.prototype.hasOwnProperty.call(value.bindings, "goToNumber")) {
      if (ACTIONS.some(({ id }) => id !== "goToNumber" && bindings[id].join("\u0000") === "v\u0000g")) bindings.goToNumber = [];
    }
    if (!validateBindings(bindings).valid) return defaults;
    return { version: SETTINGS_VERSION, bindings };
  }

  function isEditableTarget(target) {
    if (!target || typeof target.closest !== "function") return false;
    return Boolean(target.closest([
      "input",
      "textarea",
      "select",
      "option",
      "button",
      "[contenteditable]:not([contenteditable='false'])",
      "[role='textbox']"
    ].join(",")));
  }

  function isEditableEvent(event) {
    if (isEditableTarget(event && event.target)) return true;
    if (!event || typeof event.composedPath !== "function") return false;
    return event.composedPath().some((node) => isEditableTarget(node));
  }

  class SequenceMatcher {
    constructor({ bindings, onAction, now = () => Date.now(), timeoutMs = SEQUENCE_TIMEOUT_MS }) {
      this.bindings = bindings;
      this.onAction = onAction;
      this.now = now;
      this.timeoutMs = timeoutMs;
      this.prefix = null;
      this.startedAt = 0;
    }

    setBindings(bindings) {
      this.bindings = bindings;
      this.reset();
    }

    reset() {
      this.prefix = null;
      this.startedAt = 0;
    }

    handle(event) {
      if (!event || event.isComposing || event.repeat || isEditableEvent(event)) {
        this.reset();
        return false;
      }
      if (event.key === "Escape") {
        this.reset();
        return false;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) {
        this.reset();
        return false;
      }

      const token = normalizeToken(event.key);
      if (!token) {
        this.reset();
        return false;
      }

      const now = this.now();
      if (this.prefix !== null && now - this.startedAt > this.timeoutMs) this.reset();

      if (this.prefix !== null) {
        const action = ACTIONS.find(({ id }) => {
          const sequence = normalizeSequence(this.bindings[id]);
          return sequence && sequence.length === 2 && sequence[0] === this.prefix && sequence[1] === token;
        });
        if (action) {
          this.consume(event);
          this.reset();
          this.onAction(action.id);
          return true;
        }
        this.reset();
      }

      const isPrefix = ACTIONS.some(({ id }) => {
        const sequence = normalizeSequence(this.bindings[id]);
        return sequence && sequence.length === 2 && sequence[0] === token;
      });
      if (!isPrefix) return false;

      this.prefix = token;
      this.startedAt = now;
      this.consume(event);
      return true;
    }

    consume(event) {
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      else if (typeof event.stopPropagation === "function") event.stopPropagation();
    }
  }

  return Object.freeze({
    ACTIONS,
    SETTINGS_VERSION,
    SEQUENCE_TIMEOUT_MS,
    SequenceMatcher,
    defaultSettings,
    isEditableEvent,
    isEditableTarget,
    normalizeSequence,
    normalizeToken,
    sanitizeSettings,
    validateBindings
  });
});
