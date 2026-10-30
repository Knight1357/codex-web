import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

globalThis.window = { __CODEX_WEB_CONFIG__: { codexOnlyMode: true } };
const output = await mkdtemp(join(tmpdir(), "catalog-pagination-tests-"));
after(() => rm(output, { recursive: true, force: true }));
for (const name of ["codex-only", "catalog-pagination"]) {
  const source = await readFile(`src/browser/${name}.ts`, "utf8");
  const js = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replaceAll('"./codex-only"', '"./codex-only.mjs"');
  await writeFile(join(output, `${name}.mjs`), js);
}
const { catalogPagination: policy } = await import(
  pathToFileURL(join(output, "catalog-pagination.mjs"))
);
const scope = { key: "recent" };
function fixture() {
  const data = [];
  let state = { hasMore: true, isLoading: false };
  let handler = async () => {};
  let calls = 0;
  const target = {
    hostIds: ["local"],
    getEntries: () => data,
    getPageState: () => state,
    subscribe: () => () => {},
    ensurePage: async () => {
      calls++;
      await handler();
    },
    loadMore: async () => {
      calls++;
      await handler();
    },
  };
  return {
    target,
    reader: policy.reader(target),
    data,
    setHandler: (value) => {
      handler = value;
    },
    setState: (value) => {
      state = value;
    },
    calls: () => calls,
  };
}

test("only ChatGPT sources are excluded; local, SSH and cloud Codex remain", () => {
  const ids = [
    "local",
    "ssh:host",
    "remote-control:host",
    "cloud",
    "chatgpt:account:user",
  ];
  assert.deepEqual(policy.hosts(ids), ids.slice(0, 4));
  const value = { key: "scope", hostIds: ids };
  assert.deepEqual(policy.scope(value).hostIds, ids.slice(0, 4));
  assert.equal(policy.scope(value), policy.scope(value));
  assert.equal(value.hostIds, ids);
});

test("disabled mode preserves the original reader and sources", () => {
  window.__CODEX_WEB_CONFIG__.codexOnlyMode = false;
  try {
    const target = {};
    const ids = ["chatgpt:account:user"];
    assert.equal(policy.reader(target), target);
    assert.equal(policy.hosts(ids), ids);
  } finally {
    window.__CODEX_WEB_CONFIG__.codexOnlyMode = true;
  }
});

test("failed page stops loading, retains entries, and does not auto-retry", async () => {
  const f = fixture();
  f.data.push({ threadId: "existing" });
  f.setHandler(async () => {
    throw new Error("offline");
  });
  let notifications = 0;
  const unsubscribe = f.reader.subscribe(() => notifications++);
  await assert.rejects(f.reader.ensurePage(scope, 10), /offline/);
  assert.deepEqual(f.reader.getPageState(scope), {
    hasMore: false,
    isLoading: false,
    hasError: true,
  });
  await f.reader.loadMore(scope, 10);
  assert.equal(f.calls(), 1);
  assert.equal(f.data[0].threadId, "existing");
  assert.ok(notifications >= 2);
  unsubscribe();
});

test("explicit retry loads another page and clears the failure", async () => {
  const f = fixture();
  f.setHandler(async () => {
    throw new Error("403");
  });
  await assert.rejects(f.reader.ensurePage(scope, 10));
  f.setHandler(async () => {
    f.data.push({ threadId: "next" });
    f.setState({ hasMore: false, isLoading: false });
  });
  await f.reader.retryPage(scope, 10);
  assert.deepEqual(f.reader.getPageState(scope), {
    hasMore: false,
    isLoading: false,
  });
  assert.equal(f.data.length, 1);
});

test("incomplete catalog with no progress pauses pagination instead of looping", async () => {
  const f = fixture();
  await assert.rejects(f.reader.loadMore(scope, 10), /no progress/);
  assert.equal(f.reader.getPageState(scope).hasError, true);
  f.setState({ hasMore: false, isLoading: false });
  await f.reader.retryPage(scope, 10);
  assert.equal(f.reader.getPageState(scope).hasError, undefined);
});

test("overlapping requests share one operation and settle the loading state", async () => {
  const f = fixture();
  let resolve;
  f.setHandler(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const first = f.reader.ensurePage(scope, 10);
  const second = f.reader.ensurePage(scope, 10);
  assert.equal(first, second);
  assert.equal(f.reader.getPageState(scope).isLoading, true);
  await Promise.resolve();
  resolve();
  await first;
  assert.equal(f.calls(), 1);
  assert.equal(f.reader.getPageState(scope).isLoading, false);
});

test("native private-field methods remain bound to the actual reader", () => {
  class NativeReader {
    #value = 42;
    readValue() {
      return this.#value;
    }
  }
  assert.equal(policy.reader(new NativeReader()).readValue(), 42);
});
