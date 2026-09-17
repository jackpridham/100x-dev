(function exposeVortexCache(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VortexGitControlCache = api;
})(typeof globalThis === "object" ? globalThis : this, function createVortexCache() {
  "use strict";

  const CACHE_VERSION = 1;
  const REFRESH_AFTER_MS = 30 * 1000;
  const MAX_PAGES_PER_WARM = 10;

  function cacheKey(context) {
    return `issue-cache:${context.owner.toLowerCase()}/${context.repo.toLowerCase()}`;
  }

  function sortAndDedupe(issues) {
    const byNumber = new Map();
    for (const issue of issues || []) {
      if (!Number.isSafeInteger(issue.number) || typeof issue.createdAt !== "string") continue;
      byNumber.set(issue.number, {
        number: issue.number,
        createdAt: issue.createdAt,
        state: "OPEN"
      });
    }
    return [...byNumber.values()].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.number - right.number);
  }

  function selectCachedIssue(issues, currentNumber, direction) {
    if (!issues.length) return null;
    const index = issues.findIndex((issue) => issue.number === currentNumber);
    if (index < 0) return null;
    if (direction === "older") return index > 0 ? issues[index - 1] : null;
    return index < issues.length - 1 ? issues[index + 1] : issues[0];
  }

  class RepositoryIssueCache {
    constructor({ storageArea, fetchPage, now = () => Date.now(), refreshAfterMs = REFRESH_AFTER_MS, maxPagesPerWarm = MAX_PAGES_PER_WARM }) {
      this.storageArea = storageArea;
      this.fetchPage = fetchPage;
      this.now = now;
      this.refreshAfterMs = refreshAfterMs;
      this.maxPagesPerWarm = maxPagesPerWarm;
      this.inFlight = new Map();
    }

    async get(context) {
      const key = cacheKey(context);
      const result = await this.storageArea.get(key);
      const value = result && result[key];
      if (!value || value.version !== CACHE_VERSION || !Array.isArray(value.issues)) return null;
      return { ...value, issues: sortAndDedupe(value.issues) };
    }

    async warm(context, { force = false } = {}) {
      const key = cacheKey(context);
      if (this.inFlight.has(key)) {
        const current = this.inFlight.get(key);
        if (!force) return current;
        return current.then(() => {
          this.inFlight.delete(key);
          return this.warm(context, { force: true });
        });
      }
      const promise = this.warmInternal(context, key, force).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, promise);
      return promise;
    }

    async warmInternal(context, key, force) {
      const cached = await this.get(context);
      const age = cached ? this.now() - cached.updatedAt : Infinity;
      if (!force && cached && cached.complete && age < this.refreshAfterMs) return cached;

      const resume = !force && cached && !cached.complete && Number.isSafeInteger(cached.nextPage) && age < this.refreshAfterMs * 10;
      let page = resume ? cached.nextPage : 1;
      let issues = resume ? cached.issues : [];
      let pagesFetched = 0;
      let issueCount = resume ? cached.issueCount : 0;

      while (pagesFetched < this.maxPagesPerWarm) {
        const result = await this.fetchPage(context, page);
        issues = sortAndDedupe([...issues, ...result.issues]);
        issueCount = Math.max(issueCount || 0, result.issueCount || 0, issues.length);
        pagesFetched += 1;
        const complete = !result.hasNextPage;
        const value = {
          version: CACHE_VERSION,
          updatedAt: this.now(),
          complete,
          nextPage: complete ? null : page + 1,
          issueCount,
          issues
        };
        await this.storageArea.set({ [key]: value });
        if (complete) return value;
        page += 1;
      }
      return this.get(context);
    }

    async updateIssueState(context, { number, state, createdAt }) {
      const key = cacheKey(context);
      const cached = await this.get(context);
      if (!cached) return null;
      const existed = cached.issues.some((issue) => issue.number === number);
      let issues = cached.issues.filter((issue) => issue.number !== number);
      if (state === "OPEN" && typeof createdAt === "string") {
        issues = sortAndDedupe([...issues, { number, createdAt, state: "OPEN" }]);
      }
      const nowExists = issues.some((issue) => issue.number === number);
      const issueCount = Math.max(0, (cached.issueCount || cached.issues.length) + Number(nowExists) - Number(existed));
      const value = { ...cached, updatedAt: this.now(), issueCount, issues };
      await this.storageArea.set({ [key]: value });
      return value;
    }
  }

  return Object.freeze({ CACHE_VERSION, RepositoryIssueCache, cacheKey, selectCachedIssue, sortAndDedupe });
});
