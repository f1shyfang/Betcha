// Shared helpers for Vitest integration tests against the Neon test branch.
const { query } = require('../server/db');

// Wrap the real query fn so a test can assert on how many queries ran and what
// SQL was issued. This is how we encode performance invariants (e.g. "balance
// must be a single aggregate query, not a full-row fetch").
function makeQuerySpy(realQuery = query) {
  const calls = [];
  const spy = (text, params) => {
    calls.push({ text, params });
    return realQuery(text, params);
  };
  spy.calls = calls;
  spy.matching = (re) => calls.filter((c) => re.test(c.text));
  return spy;
}

// Like makeQuerySpy, but also tracks how many queries are in flight at once.
// With Promise.all, all q() calls are invoked synchronously before any awaits
// resolve, so maxInFlight reflects true concurrency; sequential awaits keep it
// at 1. This lets us assert parallelism deterministically against the real DB.
function makeInflightSpy(realQuery = query) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const spy = async (text, params) => {
    calls.push({ text, params });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      return await realQuery(text, params);
    } finally {
      inFlight--;
    }
  };
  spy.calls = calls;
  spy.matching = (re) => calls.filter((c) => re.test(c.text));
  spy.maxInFlight = () => maxInFlight;
  return spy;
}

// Unique suffix so concurrent/repeated runs don't collide on ids.
function uid(prefix) {
  return `${prefix}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

module.exports = { makeQuerySpy, makeInflightSpy, uid };
