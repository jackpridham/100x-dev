const test = require("node:test");
const assert = require("node:assert/strict");
const cacheApi = require("../src/cache.js");

function memoryStorage() {
  const values = {};
  return {
    values,
    async get(key) { return { [key]: values[key] }; },
    async set(update) { Object.assign(values, update); }
  };
}

const context = { owner: "acme", repo: "widgets" };

test("warms every issue page, persists progress, and reuses a fresh complete cache", async () => {
  const storageArea = memoryStorage();
  const calls = [];
  let now = 1000;
  const pages = {
    1: { issues: [{ number: 1, createdAt: "2025-01-01T00:00:00Z" }], hasNextPage: true, issueCount: 2 },
    2: { issues: [{ number: 3, createdAt: "2025-01-03T00:00:00Z" }], hasNextPage: false, issueCount: 2 }
  };
  const cache = new cacheApi.RepositoryIssueCache({
    storageArea,
    now: () => now,
    fetchPage: async (_context, page) => { calls.push(page); return pages[page]; }
  });
  const warmed = await cache.warm(context);
  assert.equal(warmed.complete, true);
  assert.deepEqual(warmed.issues.map((issue) => issue.number), [1, 3]);
  assert.deepEqual(calls, [1, 2]);
  now += 1000;
  await cache.warm(context);
  assert.deepEqual(calls, [1, 2]);
});

test("resumes an incomplete cache from its next page", async () => {
  const storageArea = memoryStorage();
  const key = cacheApi.cacheKey(context);
  storageArea.values[key] = {
    version: cacheApi.CACHE_VERSION,
    updatedAt: 1000,
    complete: false,
    nextPage: 2,
    issueCount: 2,
    issues: [{ number: 1, createdAt: "2025-01-01T00:00:00Z" }]
  };
  const calls = [];
  const cache = new cacheApi.RepositoryIssueCache({
    storageArea,
    now: () => 1500,
    fetchPage: async (_context, page) => {
      calls.push(page);
      return { issues: [{ number: 2, createdAt: "2025-01-02T00:00:00Z" }], hasNextPage: false, issueCount: 2 };
    }
  });
  const result = await cache.warm(context);
  assert.deepEqual(calls, [2]);
  assert.deepEqual(result.issues.map((issue) => issue.number), [1, 2]);
});

test("cached newer navigation wraps from newest to oldest", () => {
  const issues = [
    { number: 2, createdAt: "2025-01-02T00:00:00Z" },
    { number: 4, createdAt: "2025-01-04T00:00:00Z" },
    { number: 8, createdAt: "2025-01-08T00:00:00Z" }
  ];
  assert.equal(cacheApi.selectCachedIssue(issues, 4, "newer").number, 8);
  assert.equal(cacheApi.selectCachedIssue(issues, 8, "newer").number, 2);
  assert.equal(cacheApi.selectCachedIssue(issues, 2, "older"), null);
});

test("force refresh ignores a fresh cache and rebuilds from page one", async () => {
  const storageArea = memoryStorage();
  const calls = [];
  const cache = new cacheApi.RepositoryIssueCache({
    storageArea,
    now: () => 1000,
    fetchPage: async (_context, page) => {
      calls.push(page);
      return { issues: [{ number: calls.length, createdAt: `2025-01-0${calls.length}T00:00:00Z` }], hasNextPage: false, issueCount: 1 };
    }
  });
  await cache.warm(context);
  await cache.warm(context, { force: true });
  assert.deepEqual(calls, [1, 1]);
});

test("issue state changes remove closed issues and add reopened issues", async () => {
  const storageArea = memoryStorage();
  const cache = new cacheApi.RepositoryIssueCache({
    storageArea,
    now: () => 2000,
    fetchPage: async () => ({ issues: [
      { number: 1, createdAt: "2025-01-01T00:00:00Z" },
      { number: 2, createdAt: "2025-01-02T00:00:00Z" }
    ], hasNextPage: false, issueCount: 2 })
  });
  await cache.warm(context);
  let result = await cache.updateIssueState(context, { number: 2, state: "CLOSED", createdAt: "2025-01-02T00:00:00Z" });
  assert.deepEqual(result.issues.map((issue) => issue.number), [1]);
  result = await cache.updateIssueState(context, { number: 2, state: "OPEN", createdAt: "2025-01-02T00:00:00Z" });
  assert.deepEqual(result.issues.map((issue) => issue.number), [1, 2]);
});
