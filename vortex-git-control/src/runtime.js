(function exposeVortexRuntime(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VortexGitControlRuntime = api;
})(typeof globalThis === "object" ? globalThis : this, function createVortexRuntime() {
  "use strict";

  function repositoryActionUrl(context, action) {
    if (!context || !context.owner || !context.repo) return null;
    const base = `https://github.com/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}`;
    if (action === "newIssue") return `${base}/issues/new/choose`;
    if (action === "openIssues") {
      const url = new URL(`${base}/issues`);
      url.searchParams.set("q", "is:issue state:open sort:created-asc");
      return url.href;
    }
    if (action === "openPullRequests") {
      const url = new URL(`${base}/pulls`);
      url.searchParams.set("q", "is:pr is:open");
      return url.href;
    }
    return null;
  }

  function numberedPageBase(href) {
    const url = new URL(href);
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pulls|pull)(?:\/|$)/);
    if (url.origin !== "https://github.com" || !match) return null;
    return `${url.origin}/${match[1]}/${match[2]}/${match[3] === "issues" ? "issues" : "pull"}/`;
  }

  function errorMessage(error) {
    switch (error && error.code) {
      case "NOT_ISSUE": return "This is not an individual issue page.";
      case "ANCHOR_MISSING": return "Could not read this issue’s creation time.";
      case "SEARCH_FAILED": return "GitHub search could not be loaded.";
      case "UNEXPECTED_SEARCH_PAGE": return "GitHub returned an unexpected search page.";
      default: return "Vortex Git Control could not complete that action.";
    }
  }

  class NavigationGate {
    constructor() {
      this.generation = 0;
      this.active = null;
    }

    begin() {
      if (this.active) return null;
      const operation = { generation: this.generation, controller: new AbortController() };
      this.active = operation;
      return operation;
    }

    isCurrent(operation) {
      return this.active === operation && operation.generation === this.generation;
    }

    finish(operation) {
      if (this.active === operation) this.active = null;
    }

    invalidate() {
      this.generation += 1;
      if (this.active) this.active.controller.abort();
      this.active = null;
    }
  }

  function wireLifecycle(target, matcher, onPageChange) {
    const pageEvents = ["turbo:load", "turbo:render", "pjax:end", "popstate"];
    for (const eventName of pageEvents) {
      target.addEventListener(eventName, () => {
        matcher.reset();
        onPageChange();
      });
    }
    for (const eventName of ["focusin", "blur"]) {
      target.addEventListener(eventName, () => matcher.reset());
    }
  }

  return Object.freeze({ NavigationGate, errorMessage, numberedPageBase, repositoryActionUrl, wireLifecycle });
});
