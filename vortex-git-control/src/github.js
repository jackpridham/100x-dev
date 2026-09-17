(function exposeVortexGitHub(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.VortexGitControlGitHub = api;
})(typeof globalThis === "object" ? globalThis : this, function createGitHubAdapter() {
  "use strict";

  class GitHubAdapterError extends Error {
    constructor(code, message, cause) {
      super(message, cause ? { cause } : undefined);
      this.name = "GitHubAdapterError";
      this.code = code;
    }
  }

  function parseIssueUrl(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.hostname !== "github.com") return null;
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/u);
    if (!match) return null;
    try {
      const owner = decodeURIComponent(match[1]);
      const repo = decodeURIComponent(match[2]);
      const number = Number(match[3]);
      if ([owner, repo].some((part) => !part || /[\\/\p{C}\p{Z}?#]/u.test(part))) return null;
      if (!Number.isSafeInteger(number) || number < 1) return null;
      return { owner, repo, number };
    } catch {
      return null;
    }
  }

  function validNwo(value) {
    if (typeof value !== "string") return null;
    const parts = value.split("/");
    if (parts.length !== 2 || parts.some((part) => !part || /[\\/\p{C}\p{Z}?#]/u.test(part))) return null;
    return { owner: parts[0], repo: parts[1] };
  }

  const RESERVED_TOP_LEVEL_PATHS = new Set([
    "about", "account", "apps", "codespaces", "collections", "contact", "customer-stories",
    "enterprise", "events", "explore", "features", "issues", "login", "logout", "marketplace",
    "new", "notifications", "orgs", "organizations", "pricing", "pulls", "search", "security",
    "sessions", "settings", "site", "sponsors", "topics", "trending", "users"
  ]);

  function parseRepositoryUrl(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.hostname !== "github.com") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2 || RESERVED_TOP_LEVEL_PATHS.has(segments[0].toLowerCase())) return null;
    try {
      return validNwo(`${decodeURIComponent(segments[0])}/${decodeURIComponent(segments[1])}`);
    } catch {
      return null;
    }
  }

  function parseRepositoryContext(documentObject, href) {
    const selectors = [
      "meta[name='octolytics-dimension-repository_nwo']",
      "meta[name='analytics-dimension-repository_nwo']"
    ];
    for (const selector of selectors) {
      const context = validNwo(documentObject && documentObject.querySelector && documentObject.querySelector(selector)?.content);
      if (context) return context;
    }
    const issue = parseIssueUrl(href);
    if (issue) return { owner: issue.owner, repo: issue.repo };
    return parseRepositoryUrl(href);
  }

  function embeddedJsonTexts(source) {
    if (typeof source === "string") {
      const texts = [];
      const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/giu;
      for (const match of source.matchAll(pattern)) {
        const attributes = match[1];
        if (!/type=["']application\/json["']/iu.test(attributes)) continue;
        if (!/data-target=["']react-app\.embeddedData["']/iu.test(attributes)) continue;
        texts.push(match[2]);
      }
      return texts;
    }
    if (!source || typeof source.querySelectorAll !== "function") return [];
    return Array.from(source.querySelectorAll("script[type='application/json'][data-target='react-app.embeddedData']"), (node) => node.textContent || "");
  }

  function parseEmbeddedPayloads(source) {
    const payloads = [];
    for (const text of embeddedJsonTexts(source)) {
      try {
        payloads.push(JSON.parse(text));
      } catch {
        // GitHub can leave a stale partial during soft navigation; another payload may be valid.
      }
    }
    return payloads;
  }

  function walkObjects(value, visit) {
    if (!value || typeof value !== "object") return;
    visit(value);
    if (Array.isArray(value)) {
      for (const item of value) walkObjects(item, visit);
      return;
    }
    for (const item of Object.values(value)) walkObjects(item, visit);
  }

  function repositoryFromNode(node) {
    const repository = node && node.repository;
    if (!repository || typeof repository !== "object") return null;
    if (typeof repository.nameWithOwner === "string") return validNwo(repository.nameWithOwner);
    const owner = repository.owner && (repository.owner.login || repository.owner.name);
    return owner && repository.name ? { owner, repo: repository.name } : null;
  }

  function issueRecord(node) {
    const isIssue = node && (node.__typename === "Issue" || node.__isIssueOrPullRequest === "Issue");
    if (!isIssue || !Number.isInteger(node.number) || typeof node.createdAt !== "string") return null;
    const timestamp = Date.parse(node.createdAt);
    if (!Number.isFinite(timestamp)) return null;
    const repository = repositoryFromNode(node);
    return {
      number: node.number,
      createdAt: new Date(timestamp).toISOString(),
      state: typeof node.state === "string" ? node.state.toUpperCase() : null,
      owner: repository && repository.owner,
      repo: repository && repository.repo,
      url: typeof node.url === "string" ? node.url : null
    };
  }

  function extractIssueRecords(source) {
    const records = [];
    for (const payload of parseEmbeddedPayloads(source)) {
      walkObjects(payload, (node) => {
        const record = issueRecord(node);
        if (record) records.push(record);
      });
    }
    return records;
  }

  function sameRepository(record, context) {
    if (!record.owner || !record.repo) return false;
    return record.owner?.toLocaleLowerCase("en-US") === context.owner.toLocaleLowerCase("en-US")
      && record.repo?.toLocaleLowerCase("en-US") === context.repo.toLocaleLowerCase("en-US");
  }

  function visibleCreationTime(documentObject) {
    if (!documentObject || typeof documentObject.querySelector !== "function") return null;
    const selectors = [
      "[data-testid='issue-body-header-link'] relative-time",
      "[data-testid='issue-body-header-link'] time-ago",
      "[data-testid='issue-body'] relative-time",
      "relative-time[datetime]",
      "time-ago[datetime]"
    ];
    for (const selector of selectors) {
      const element = documentObject.querySelector(selector);
      if (!element) continue;
      const values = [
        element.getAttribute && element.getAttribute("datetime"),
        element.getAttribute && element.getAttribute("title"),
        element.date instanceof Date && element.date.toISOString(),
        element.textContent && element.textContent.replace(/^\s*on\s+/iu, "").trim()
      ].filter(Boolean);
      for (const value of values) {
        const timestamp = Date.parse(value);
        if (!Number.isFinite(timestamp)) continue;
        const hasExactTime = /T\d{2}:\d{2}/u.test(value) || /\d{1,2}:\d{2}/u.test(value);
        const parsed = new Date(timestamp);
        const normalized = hasExactTime
          ? parsed
          : new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
        return { createdAt: normalized.toISOString(), precision: hasExactTime ? "exact" : "day" };
      }
    }
    return null;
  }

  function readIssueState(documentObject) {
    if (!documentObject || typeof documentObject.querySelector !== "function") return null;
    const element = documentObject.querySelector("[data-testid='header-state']");
    if (!element) return null;
    const status = (element.getAttribute && element.getAttribute("data-status") || "").toLowerCase();
    const text = (element.textContent || "").trim().toLowerCase();
    if (status.includes("open") || /^open\b/u.test(text)) return "OPEN";
    if (status.includes("closed") || /^closed\b/u.test(text) || /^completed\b/u.test(text)) return "CLOSED";
    return null;
  }

  function extractCurrentIssue(documentObject, href) {
    const context = parseIssueUrl(href);
    if (!context) throw new GitHubAdapterError("NOT_ISSUE", "The current URL is not an individual GitHub issue.");
    const numbered = extractIssueRecords(documentObject).filter((record) => record.number === context.number);
    const candidates = numbered.filter((record) => sameRepository(record, context));
    const preferred = candidates.find((record) => record.url && parseIssueUrl(record.url)?.number === context.number)
      || candidates[0]
      || numbered.find((record) => !record.owner && !record.repo);
    if (preferred) return { ...context, createdAt: preferred.createdAt, state: preferred.state, precision: "exact" };

    const visible = visibleCreationTime(documentObject);
    if (visible) return { ...context, ...visible, state: null };
    throw new GitHubAdapterError("ANCHOR_MISSING", "The issue creation time was not present in GitHub's page data.");
  }

  function buildAdjacentSearchUrl(anchor, direction) {
    if (direction !== "older" && direction !== "newer") throw new TypeError("direction must be older or newer");
    const dayPrecision = anchor.precision === "day";
    const startOfDay = new Date(anchor.createdAt);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const nextDay = new Date(startOfDay);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const operator = direction === "older" ? (dayPrecision ? "<" : "<=") : ">=";
    const boundary = dayPrecision
      ? (direction === "older" ? nextDay.toISOString() : startOfDay.toISOString())
      : anchor.createdAt;
    const sort = direction === "older" ? "created-desc" : "created-asc";
    const query = [
      `repo:${anchor.owner}/${anchor.repo}`,
      "is:issue",
      "state:open",
      `created:${operator}${boundary}`,
      `sort:${sort}`
    ].join(" ");
    const url = new URL(`https://github.com/${encodeURIComponent(anchor.owner)}/${encodeURIComponent(anchor.repo)}/issues`);
    url.searchParams.set("q", query);
    return url.href;
  }

  function compareTuple(left, right) {
    if (right.precision === "day" && left.createdAt.slice(0, 10) === right.createdAt.slice(0, 10)) {
      return left.number - right.number;
    }
    const timeDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    return timeDifference || left.number - right.number;
  }

  function canonicalIssueUrl(context, number) {
    return `https://github.com/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}/issues/${number}`;
  }

  function fallbackIssueUrls(html, context) {
    if (typeof html !== "string") return [];
    const urls = [];
    const anchorPattern = /<a\b([^>]*)>/giu;
    for (const match of html.matchAll(anchorPattern)) {
      const attrs = match[1];
      if (!/data-testid=["']issue-pr-title-link["']/iu.test(attrs)) continue;
      const hrefMatch = attrs.match(/href=["']([^"']+)["']/iu);
      if (!hrefMatch) continue;
      let parsed;
      try { parsed = new URL(hrefMatch[1], "https://github.com"); } catch { continue; }
      const issue = parseIssueUrl(parsed.href);
      if (issue && issue.owner.toLowerCase() === context.owner.toLowerCase() && issue.repo.toLowerCase() === context.repo.toLowerCase()) urls.push(parsed.href);
    }
    return [...new Set(urls)];
  }

  function repositorySearches(payloads) {
    const searches = [];
    for (const payload of payloads) {
      walkObjects(payload, (node) => {
        if (node.repository && node.repository.search && Array.isArray(node.repository.search.edges)) {
          searches.push(node.repository.search);
        }
      });
    }
    return searches;
  }

  function parseSearchPage(html, context) {
    const payloads = parseEmbeddedPayloads(html);
    const searches = repositorySearches(payloads);
    if (!searches.length) throw new GitHubAdapterError("UNEXPECTED_SEARCH_PAGE", "GitHub did not return a structured issue-search page.");
    const seen = new Set();
    const issues = [];
    const fallbackNumbers = new Set();
    for (const { edges } of searches) {
      for (const edge of edges) {
        const node = edge && edge.node;
        const record = issueRecord(node);
        const recordBelongsHere = record && ((!record.owner && !record.repo) || sameRepository(record, context));
        if (recordBelongsHere && record.state === "OPEN" && !seen.has(record.number)) {
          if (!record.owner && !record.repo) Object.assign(record, { owner: context.owner, repo: context.repo });
          seen.add(record.number);
          issues.push(record);
        }
        const repository = repositoryFromNode(node);
        if (node && node.__typename === "Issue" && node.state === "OPEN" && Number.isSafeInteger(node.number)
          && (!repository || sameRepository({ owner: repository.owner, repo: repository.repo }, context))) {
          fallbackNumbers.add(node.number);
        }
      }
    }
    const fallbackUrls = fallbackIssueUrls(html, context).filter((url) => fallbackNumbers.has(parseIssueUrl(url)?.number));
    const issueCount = Math.max(issues.length, ...searches.map((search) => Number(search.issueCount) || 0));
    const hasNextPage = searches.some((search) => Boolean(search.pageInfo && search.pageInfo.hasNextPage));
    return { issues, fallbackUrls, issueCount, hasNextPage };
  }

  function buildOpenIssuesSearchUrl(context, page = 1) {
    const query = [`repo:${context.owner}/${context.repo}`, "is:issue", "state:open", "sort:created-asc"].join(" ");
    const url = new URL(`https://github.com/${encodeURIComponent(context.owner)}/${encodeURIComponent(context.repo)}/issues`);
    url.searchParams.set("q", query);
    if (page > 1) url.searchParams.set("page", String(page));
    return url.href;
  }

  async function fetchOpenIssuesPage({ context, page = 1, fetchImpl = globalThis.fetch, signal }) {
    const searchUrl = buildOpenIssuesSearchUrl(context, page);
    let response;
    try {
      response = await fetchImpl(searchUrl, { credentials: "same-origin", headers: { Accept: "text/html" }, signal });
    } catch (error) {
      throw new GitHubAdapterError("SEARCH_FAILED", "GitHub's open issues could not be loaded.", error);
    }
    if (!response || !response.ok) throw new GitHubAdapterError("SEARCH_FAILED", `GitHub search returned HTTP ${response && response.status}.`);
    let html;
    try {
      html = await response.text();
    } catch (error) {
      throw new GitHubAdapterError("SEARCH_FAILED", "GitHub search response could not be read.", error);
    }
    const parsed = parseSearchPage(html, context);
    return {
      issues: parsed.issues,
      hasNextPage: parsed.hasNextPage,
      issueCount: parsed.issueCount,
      page,
      searchUrl
    };
  }

  function selectAdjacent(anchor, records, direction) {
    const eligible = records.filter((record) => {
      const comparison = compareTuple(record, anchor);
      return direction === "older" ? comparison < 0 : comparison > 0;
    });
    eligible.sort((left, right) => direction === "older" ? compareTuple(right, left) : compareTuple(left, right));
    return eligible[0] || null;
  }

  async function findAdjacentIssue({ document: documentObject, href, direction, fetchImpl = globalThis.fetch, signal }) {
    const anchor = extractCurrentIssue(documentObject, href);
    const searchUrl = buildAdjacentSearchUrl(anchor, direction);
    let response;
    try {
      response = await fetchImpl(searchUrl, { credentials: "same-origin", headers: { Accept: "text/html" }, signal });
    } catch (error) {
      throw new GitHubAdapterError("SEARCH_FAILED", "GitHub search could not be loaded.", error);
    }
    if (!response || !response.ok) throw new GitHubAdapterError("SEARCH_FAILED", `GitHub search returned HTTP ${response && response.status}.`);
    if (response.url) {
      const finalUrl = new URL(response.url, "https://github.com");
      if (finalUrl.hostname !== "github.com" || /^\/(login|session)(\/|$)/u.test(finalUrl.pathname)) {
        throw new GitHubAdapterError("SEARCH_FAILED", "GitHub redirected the issue search away from the repository.");
      }
    }
    let html;
    try {
      html = await response.text();
    } catch (error) {
      throw new GitHubAdapterError("SEARCH_FAILED", "GitHub search response could not be read.", error);
    }
    const parsed = parseSearchPage(html, anchor);
    const selected = selectAdjacent(anchor, parsed.issues, direction);
    if (selected) return canonicalIssueUrl(anchor, selected.number);

    const fallback = parsed.fallbackUrls.find((url) => parseIssueUrl(url)?.number !== anchor.number);
    return fallback || null;
  }

  return Object.freeze({
    GitHubAdapterError,
    buildAdjacentSearchUrl,
    buildOpenIssuesSearchUrl,
    canonicalIssueUrl,
    extractCurrentIssue,
    extractIssueRecords,
    fetchOpenIssuesPage,
    findAdjacentIssue,
    parseIssueUrl,
    parseRepositoryContext,
    parseRepositoryUrl,
    parseSearchPage,
    readIssueState,
    selectAdjacent
  });
});
