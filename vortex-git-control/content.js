(function initializeVortexGitControl() {
  "use strict";

  const core = globalThis.VortexGitControlCore;
  const github = globalThis.VortexGitControlGitHub;
  const cacheApi = globalThis.VortexGitControlCache;
  const runtime = globalThis.VortexGitControlRuntime;
  const pullRequest = globalThis.VortexGitControlPullRequest;
  let settings = core.defaultSettings();
  let toastTimer = null;
  let markCurrentFileViewedRunning = false;
  let focusNextUnviewedFileRunning = false;
  const navigationGate = new runtime.NavigationGate();
  const pullRequestNavigationGate = new runtime.NavigationGate();
  const issueCache = new cacheApi.RepositoryIssueCache({
    storageArea: chrome.storage.local,
    fetchPage: (context, page) => github.fetchOpenIssuesPage({ context, page })
  });

  function showToast(message, kind = "info") {
    let toast = document.getElementById("vortex-git-control-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "vortex-git-control-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.setAttribute("aria-atomic", "true");
      document.documentElement.append(toast);
    }
    toast.dataset.kind = kind;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, kind === "loading" ? 10000 : 3200);
  }

  function navigate(url) {
    window.location.assign(url);
  }

  let numberDialog = null;

  function goToNumber() {
    const base = runtime.numberedPageBase(window.location.href);
    if (!base) {
      showToast("Open an Issues or Pull requests page first.", "neutral");
      return;
    }
    if (numberDialog?.open) return;
    const dialog = document.createElement("dialog");
    numberDialog = dialog;
    dialog.id = "vortex-git-control-number-dialog";
    dialog.setAttribute("aria-labelledby", "vortex-git-control-number-label");
    const form = document.createElement("form");
    const label = document.createElement("label");
    label.id = "vortex-git-control-number-label";
    label.htmlFor = "vortex-git-control-number";
    label.textContent = base.endsWith("/issues/") ? "Open issue number" : "Open pull request number";
    const input = document.createElement("input");
    input.id = label.htmlFor;
    input.type = "text";
    input.inputMode = "numeric";
    input.pattern = "[0-9]+";
    input.required = true;
    input.autofocus = true;
    input.autocomplete = "off";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Open";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => dialog.close());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      navigate(base + input.value);
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (numberDialog === dialog) numberDialog = null;
    });
    form.append(label, input, submit, cancel);
    dialog.append(form);
    document.documentElement.append(dialog);
    dialog.showModal();
    input.focus();
  }

  function ensureSettingsButton() {
    if (document.getElementById("vortex-git-control-settings")) return;
    const button = document.createElement("button");
    button.id = "vortex-git-control-settings";
    button.type = "button";
    button.title = "Vortex Git Control settings";
    button.setAttribute("aria-label", button.title);
    button.textContent = "⚙";
    button.addEventListener("click", async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: "vortex-open-options" });
        if (!response?.ok) throw new Error("Options unavailable");
      } catch {
        showToast("Could not open settings. Reload this tab if the extension was updated.", "error");
      }
    });
    document.documentElement.append(button);
  }
  ensureSettingsButton();

  async function navigateAdjacent(direction) {
    const operation = navigationGate.begin();
    if (!operation) return;
    try {
      const issueContext = github.parseIssueUrl(window.location.href);
      if (!issueContext) throw new github.GitHubAdapterError("NOT_ISSUE", "The current URL is not an individual issue.");
      const cached = await issueCache.get(issueContext);
      if (!navigationGate.isCurrent(operation)) return;
      if (cached && cached.complete && cached.issues.length) {
        const direct = cacheApi.selectCachedIssue(cached.issues, issueContext.number, direction);
        if (direct) {
          navigate(github.canonicalIssueUrl(issueContext, direct.number));
          return;
        }
        const anchor = github.extractCurrentIssue(document, window.location.href);
        const adjacent = github.selectAdjacent(anchor, cached.issues, direction);
        const target = adjacent || (direction === "newer" ? cached.issues[0] : null);
        if (target) {
          navigate(github.canonicalIssueUrl(issueContext, target.number));
          return;
        }
        showToast(`No ${direction} open issue.`, "neutral");
        return;
      }

      showToast(`Finding ${direction} open issue…`, "loading");
      const url = await github.findAdjacentIssue({
        document,
        href: window.location.href,
        direction,
        signal: operation.controller.signal
      });
      if (!navigationGate.isCurrent(operation)) return;
      if (!url) {
        if (direction === "newer") {
          const firstPage = await github.fetchOpenIssuesPage({ context: issueContext, page: 1, signal: operation.controller.signal });
          if (!navigationGate.isCurrent(operation)) return;
          if (firstPage.issues[0]) {
            navigate(github.canonicalIssueUrl(issueContext, firstPage.issues[0].number));
            return;
          }
        }
        showToast(`No ${direction} open issue.`, "neutral");
        return;
      }
      navigate(url);
    } catch (error) {
      if (!navigationGate.isCurrent(operation)) return;
      showToast(runtime.errorMessage(error), "error");
    } finally {
      navigationGate.finish(operation);
    }
  }

  function navigateRepositoryAction(action) {
    const context = github.parseRepositoryContext(document, window.location.href);
    if (!context) {
      showToast("This page is not inside a GitHub repository.", "error");
      return;
    }
    const url = runtime.repositoryActionUrl(context, action);
    if (url) navigate(url);
  }

  async function refreshIssueCache() {
    const context = github.parseRepositoryContext(document, window.location.href);
    if (!context) {
      showToast("This page is not inside a GitHub repository.", "error");
      return;
    }
    showToast("Refreshing open issue cache…", "loading");
    try {
      const result = await issueCache.warm(context, { force: true });
      if (!result) throw new Error("Cache refresh returned no data");
      const suffix = result.complete || !result.issueCount ? "" : ` of ${result.issueCount}`;
      showToast(`Cached ${result.issues.length}${suffix} open issues.`, "neutral");
    } catch {
      showToast("Could not refresh the open issue cache.", "error");
    }
  }

  async function markCurrentFileViewed() {
    if (markCurrentFileViewedRunning) return;
    const operation = pullRequestNavigationGate.begin();
    if (!operation) return;
    markCurrentFileViewedRunning = true;
    try {
      const result = await pullRequest.markCurrentFileViewedAndFocusNext({
        document,
        href: window.location.href,
        signal: operation.controller.signal
      });
      if (!pullRequestNavigationGate.isCurrent(operation)) return;
      if (result.mark.status === "wrong-page") showToast("This action only works on a pull request Files changed page.", "error");
      else if (result.mark.status === "missing-controls") showToast("Could not find GitHub file-view controls.", "error");
      else if (result.mark.status === "no-current-file") showToast("No file is currently in view.", "neutral");
      else if (result.focus && result.focus.status === "success") {
        showToast(result.mark.status === "success"
          ? "Marked the current file viewed and focused the next unviewed file."
          : "The current file was already viewed; focused the next unviewed file.", "neutral");
      } else if (result.focus && result.focus.status === "no-next-unviewed") {
        showToast(result.mark.status === "success"
          ? "Marked the current file viewed. No later unviewed file."
          : "The current file is already viewed. No later unviewed file.", "neutral");
      } else if (result.focus && result.focus.status === "missing-controls") {
        showToast("Updated the current file, but could not find the next file-view controls.", "error");
      } else if (result.focus && result.focus.status === "no-current-file") {
        showToast("Updated the current file, but no file is currently in view.", "neutral");
      }
    } catch {
      if (!pullRequestNavigationGate.isCurrent(operation)) return;
      showToast("Could not mark the current file viewed and advance.", "error");
    } finally {
      pullRequestNavigationGate.finish(operation);
      markCurrentFileViewedRunning = false;
    }
  }

  async function focusNextUnviewedFile() {
    if (focusNextUnviewedFileRunning) return;
    const operation = pullRequestNavigationGate.begin();
    if (!operation) return;
    focusNextUnviewedFileRunning = true;
    try {
      const result = await pullRequest.focusNextUnviewedFile({
        document,
        href: window.location.href,
        signal: operation.controller.signal
      });
      if (!pullRequestNavigationGate.isCurrent(operation)) return;
      if (result.status === "wrong-page") showToast("This action only works on a pull request Files changed page.", "error");
      else if (result.status === "missing-controls") showToast("Could not find GitHub file-view controls.", "error");
      else if (result.status === "no-current-file") showToast("No file is currently in view.", "neutral");
      else if (result.status === "no-next-unviewed") showToast("No later unviewed file.", "neutral");
      else if (result.status === "success") showToast("Focused the next unviewed file.", "neutral");
    } catch {
      if (!pullRequestNavigationGate.isCurrent(operation)) return;
      showToast("Could not focus the next unviewed file.", "error");
    } finally {
      pullRequestNavigationGate.finish(operation);
      focusNextUnviewedFileRunning = false;
    }
  }

  function runAction(action) {
    if (action === "olderIssue") void navigateAdjacent("older");
    else if (action === "newerIssue") void navigateAdjacent("newer");
    else if (action === "refreshCache") void refreshIssueCache();
    else if (action === "goToNumber") goToNumber();
    else if (action === "markCurrentFileViewed") void markCurrentFileViewed();
    else if (action === "focusNextUnviewedFile") void focusNextUnviewedFile();
    else navigateRepositoryAction(action);
  }

  const matcher = new core.SequenceMatcher({ bindings: settings.bindings, onAction: runAction });
  window.addEventListener("keydown", (event) => matcher.handle(event), true);

  function warmCurrentRepository() {
    const context = github.parseRepositoryContext(document, window.location.href);
    if (context) void issueCache.warm(context).catch(() => {});
  }

  let stateCheckTimer = null;
  let observedIssueKey = null;
  let observedIssueState = null;

  async function synchronizeCurrentIssueState() {
    const context = github.parseIssueUrl(window.location.href);
    if (!context) {
      observedIssueKey = null;
      observedIssueState = null;
      return;
    }
    const state = github.readIssueState(document);
    if (!state) return;
    const key = `${context.owner.toLowerCase()}/${context.repo.toLowerCase()}#${context.number}`;
    const changed = observedIssueKey === key && observedIssueState && observedIssueState !== state;
    observedIssueKey = key;
    observedIssueState = state;
    let createdAt = null;
    try { createdAt = github.extractCurrentIssue(document, window.location.href).createdAt; } catch {}
    await issueCache.updateIssueState(context, { number: context.number, state, createdAt });
    if (changed) void issueCache.warm(context, { force: true }).catch(() => {});
  }

  const stateObserver = new MutationObserver(() => {
    clearTimeout(stateCheckTimer);
    stateCheckTimer = setTimeout(() => void synchronizeCurrentIssueState(), 200);
  });
  if (document.body) stateObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-status"] });

  runtime.wireLifecycle(window, matcher, () => {
    if (numberDialog?.open) numberDialog.close();
    ensureSettingsButton();
    navigationGate.invalidate();
    pullRequestNavigationGate.invalidate();
    setTimeout(warmCurrentRepository, 0);
    setTimeout(() => void synchronizeCurrentIssueState(), 0);
  });
  warmCurrentRepository();
  void synchronizeCurrentIssueState();
  setInterval(warmCurrentRepository, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") warmCurrentRepository();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes.settings) return;
    settings = core.sanitizeSettings(changes.settings.newValue);
    matcher.setBindings(settings.bindings);
  });

  chrome.storage.sync.get("settings").then(({ settings: stored }) => {
    settings = core.sanitizeSettings(stored);
    matcher.setBindings(settings.bindings);
  }).catch(() => {
    matcher.setBindings(settings.bindings);
  });
})();
