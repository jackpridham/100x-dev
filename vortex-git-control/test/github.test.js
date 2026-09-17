const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const github = require("../src/github.js");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const documentFromHtml = (html) => ({
  querySelector(selector) {
    if (!selector.includes("repository_nwo")) return null;
    const match = html.match(/<meta[^>]+name="octolytics-dimension-repository_nwo"[^>]+content="([^"]+)"/u);
    return match ? { content: match[1] } : null;
  },
  querySelectorAll(selector) {
    if (!selector.includes("react-app.embeddedData")) return [];
    return Array.from(html.matchAll(/<script type="application\/json" data-target="react-app\.embeddedData">([\s\S]*?)<\/script>/gu), (match) => ({ textContent: match[1] }));
  }
});

test("recognizes only canonical individual github.com issue URLs", () => {
  assert.deepEqual(github.parseIssueUrl("https://github.com/acme/widgets/issues/42?x=1#top"), { owner: "acme", repo: "widgets", number: 42 });
  assert.equal(github.parseIssueUrl("https://github.com/acme/widgets/pull/42"), null);
  assert.equal(github.parseIssueUrl("https://github.com/acme/widgets/issues/new"), null);
  assert.equal(github.parseIssueUrl("https://example.com/acme/widgets/issues/42"), null);
  assert.equal(github.parseIssueUrl("https://github.com/acme/%E0%A4%A/issues/42"), null);
  assert.equal(github.parseIssueUrl("https://github.com/acme%2Fevil/widgets/issues/42"), null);
  assert.equal(github.parseIssueUrl("https://github.com/acme/widgets/issues/9007199254740993"), null);
});

test("derives repository context from any repository URL when metadata is absent", () => {
  const emptyDocument = { querySelector: () => null };
  assert.deepEqual(github.parseRepositoryContext(emptyDocument, "https://github.com/jackpridham/vue-vxapp"), { owner: "jackpridham", repo: "vue-vxapp" });
  assert.deepEqual(github.parseRepositoryContext(emptyDocument, "https://github.com/jackpridham/vue-vxapp/tree/development"), { owner: "jackpridham", repo: "vue-vxapp" });
  assert.deepEqual(github.parseRepositoryContext(emptyDocument, "https://github.com/jackpridham/vue-vxapp/issues/85"), { owner: "jackpridham", repo: "vue-vxapp" });
  assert.equal(github.parseRepositoryContext(emptyDocument, "https://github.com/settings/profile"), null);
  assert.equal(github.parseRepositoryContext(emptyDocument, "https://github.com/search?q=repo"), null);
});

test("extracts open and closed issues as chronological anchors", () => {
  for (const name of ["issue-open.html", "issue-closed.html"]) {
    const html = fixture(name);
    const issue = github.extractCurrentIssue(documentFromHtml(html), "https://github.com/acme/widgets/issues/42");
    assert.equal(issue.createdAt, "2026-07-10T10:00:00.000Z");
    assert.equal(issue.number, 42);
  }
});

test("accepts private-page issue records that omit redundant repository identity", () => {
  const html = `<script type="application/json" data-target="react-app.embeddedData">{"payload":{"issue":{"__typename":"Issue","number":85,"createdAt":"2025-12-01T04:05:06Z","state":"OPEN"}}}</script>`;
  const issue = github.extractCurrentIssue(documentFromHtml(html), "https://github.com/jackpridham/vue-vxapp/issues/85");
  assert.equal(issue.createdAt, "2025-12-01T04:05:06.000Z");
  assert.equal(issue.precision, "exact");
});

test("falls back to the visible issue opening date when private payload data is unavailable", () => {
  const element = { getAttribute: () => null, textContent: "on Dec 1, 2025" };
  const documentObject = {
    querySelector: (selector) => selector.includes("issue-body-header-link") ? element : null,
    querySelectorAll: () => []
  };
  const issue = github.extractCurrentIssue(documentObject, "https://github.com/jackpridham/vue-vxapp/issues/85");
  assert.equal(issue.createdAt.slice(0, 10), "2025-12-01");
  assert.equal(issue.precision, "day");
  const olderQuery = new URL(github.buildAdjacentSearchUrl(issue, "older")).searchParams.get("q");
  assert.match(olderQuery, /created:<2025-12-02T00:00:00.000Z/);
});

test("builds inclusive open-issue searches in the correct direction", () => {
  const anchor = { owner: "acme", repo: "widgets", number: 42, createdAt: "2026-07-10T10:00:00.000Z" };
  const older = new URL(github.buildAdjacentSearchUrl(anchor, "older")).searchParams.get("q");
  const newer = new URL(github.buildAdjacentSearchUrl(anchor, "newer")).searchParams.get("q");
  assert.match(older, /is:issue state:open/);
  assert.match(older, /created:<=2026-07-10T10:00:00.000Z sort:created-desc/);
  assert.match(newer, /created:>=2026-07-10T10:00:00.000Z sort:created-asc/);
});

test("search parsing excludes pull requests, closed pins, and other repositories", () => {
  const result = github.parseSearchPage(fixture("search-results.html"), { owner: "acme", repo: "widgets" });
  assert.deepEqual(result.issues.map((issue) => issue.number), [40, 41, 43, 44]);
});

test("accepts private search result nodes that omit redundant repository identity", () => {
  const html = `<script type="application/json" data-target="react-app.embeddedData">{"payload":{"repository":{"search":{"edges":[{"node":{"__typename":"Issue","number":84,"createdAt":"2025-11-30T10:00:00Z","state":"OPEN"}}]}}}}</script>`;
  const result = github.parseSearchPage(html, { owner: "jackpridham", repo: "vue-vxapp" });
  assert.deepEqual(result.issues.map((issue) => issue.number), [84]);
  assert.equal(result.issues[0].owner, "jackpridham");
});

test("selects nearest neighbors using creation time and issue number ties", () => {
  const anchor = { owner: "acme", repo: "widgets", number: 42, createdAt: "2026-07-10T10:00:00.000Z" };
  const records = github.parseSearchPage(fixture("search-results.html"), anchor).issues;
  assert.equal(github.selectAdjacent(anchor, records, "older").number, 41);
  assert.equal(github.selectAdjacent(anchor, records, "newer").number, 43);
  assert.equal(github.selectAdjacent({ ...anchor, number: 1, createdAt: "2010-01-01T00:00:00Z" }, records, "older"), null);
});

test("findAdjacentIssue uses same-session HTML and works from a closed anchor", async () => {
  const html = fixture("issue-closed.html");
  let request;
  const url = await github.findAdjacentIssue({
    document: documentFromHtml(html),
    href: "https://github.com/acme/widgets/issues/42",
    direction: "newer",
    fetchImpl: async (href, options) => {
      request = { href, options };
      return { ok: true, status: 200, url: href, text: async () => fixture("search-results.html") };
    }
  });
  assert.equal(url, "https://github.com/acme/widgets/issues/43");
  assert.equal(request.options.credentials, "same-origin");
});

test("surfaces missing anchors, invalid search pages, and network failures", async () => {
  assert.throws(() => github.extractCurrentIssue(documentFromHtml(""), "https://github.com/acme/widgets/issues/42"), { code: "ANCHOR_MISSING" });
  assert.throws(() => github.parseSearchPage("<html>login</html>", { owner: "acme", repo: "widgets" }), { code: "UNEXPECTED_SEARCH_PAGE" });
  assert.throws(() => github.parseSearchPage('<script type="application/json" data-target="react-app.embeddedData">{"payload":{"viewer":{"login":"me"}}}</script>', { owner: "acme", repo: "widgets" }), { code: "UNEXPECTED_SEARCH_PAGE" });
  assert.throws(() => github.parseSearchPage('<script type="application/json" data-target="react-app.embeddedData">{"payload":{"globalSearch":{"search":{"edges":[]}}}}</script>', { owner: "acme", repo: "widgets" }), { code: "UNEXPECTED_SEARCH_PAGE" });
  await assert.rejects(() => github.findAdjacentIssue({
    document: documentFromHtml(fixture("issue-open.html")),
    href: "https://github.com/acme/widgets/issues/42",
    direction: "older",
    fetchImpl: async () => { throw new Error("offline"); }
  }), { code: "SEARCH_FAILED" });
  await assert.rejects(() => github.findAdjacentIssue({
    document: documentFromHtml(fixture("issue-open.html")),
    href: "https://github.com/acme/widgets/issues/42",
    direction: "older",
    fetchImpl: async (href) => ({ ok: true, status: 200, url: href, text: async () => { throw new Error("body failed"); } })
  }), { code: "SEARCH_FAILED" });
});

test("empty search results do not fall back to a closed pinned link", () => {
  const html = `<script type="application/json" data-target="react-app.embeddedData">{"payload":{"repository":{"search":{"edges":[]},"pinnedIssues":{"nodes":[{"issue":{"__typename":"Issue","number":99,"state":"CLOSED"}}]}}}}</script>
    <a href="/acme/widgets/issues/99" data-testid="issue-pr-title-link">Pinned closed issue</a>`;
  const parsed = github.parseSearchPage(html, { owner: "acme", repo: "widgets" });
  assert.deepEqual(parsed, { issues: [], fallbackUrls: [], issueCount: 0, hasNextPage: false });
});

test("reads open and closed issue state from GitHub's live header", () => {
  const documentFor = (status, text) => ({
    querySelector: () => ({ getAttribute: () => status, textContent: text })
  });
  assert.equal(github.readIssueState(documentFor("issueOpened", "Open")), "OPEN");
  assert.equal(github.readIssueState(documentFor("issueClosed", "Closed")), "CLOSED");
});
