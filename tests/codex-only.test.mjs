import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Exercise the real browser policy without launching the CLI or reading credentials.
const output = await mkdtemp(join(tmpdir(), "codex-only-tests-"));
const handlers = {};
globalThis.window = {
  __CODEX_WEB_CONFIG__: { codexOnlyMode: false },
  addEventListener(type, handler) {
    handlers[type] = handler;
  },
  dispatchEvent(event) {
    this.lastEvent = event;
  },
  location: { pathname: "/", search: "" },
};
async function compile(source, name) {
  const input = await readFile(resolve(source), "utf8");
  const js = ts
    .transpileModule(input, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replaceAll('"./codex-only"', '"./codex-only.mjs"');
  await writeFile(join(output, name + ".mjs"), js);
  return import(pathToFileURL(join(output, name + ".mjs")));
}
const policy = await compile("src/browser/codex-only.ts", "codex-only");
const routes = await compile("src/browser/routes.ts", "routes");
const config = await compile("src/server/ui-config.ts", "ui-config");
const enabled = (value) => {
  window.__CODEX_WEB_CONFIG__.codexOnlyMode = value;
};

try {
  test("flag defaults off and accepts only true; publishes no environment or credentials", () => {
    for (const value of [undefined, "", "false", "0", "1", "yes"])
      assert.equal(
        config.readUiConfig({ CODEX_ONLY_MODE: value }).codexOnlyMode,
        false,
      );
    assert.equal(
      config.readUiConfig({ CODEX_ONLY_MODE: " TRUE " }).codexOnlyMode,
      true,
    );
    assert.equal(
      config.uiConfigScript(
        config.readUiConfig({ CODEX_ONLY_MODE: "true", SECRET: "private" }),
      ),
      'window.__CODEX_WEB_CONFIG__ = Object.freeze({"codexOnlyMode":true});',
    );
  });
  test("disabled mode retains routing, navigation, settings and history behavior", () => {
    enabled(false);
    assert.deepEqual(
      routes.mapBrowserPathToInitialRoute("/settings/voice", "?x=1"),
      { memoryPath: "/" },
    );
    assert.deepEqual(routes.mapMemoryPathToBrowserPath("/"), {
      path: "/",
      titleChange: "Codex",
    });
    assert.equal(routes.mapMemoryPathToBrowserPath("/settings/account"), null);
    assert.equal(
      policy.normalizeRoute("/chatgpt/quick-chat"),
      "/chatgpt/quick-chat",
    );
    const items = [{ id: "builtin:sites" }];
    assert.equal(policy.codexOnlyUi.filterDestinations(items), items);
    const settings = [{ slug: "voice" }];
    assert.equal(policy.codexOnlyUi.filterSettings(settings), settings);
    const h = { push() {}, replace() {} };
    const push = h.push;
    policy.guardHistory(h);
    assert.equal(h.push, push);
    assert.equal(
      policy.codexOnlyUi.isCommandAllowed({ id: "switchToMode1" }),
      true,
    );
  });
  test("Codex deep links and project/review queries survive refresh and browser history", () => {
    enabled(true);
    assert.equal(
      routes.mapBrowserPathToInitialRoute("/codex", "?prompt=hello").memoryPath,
      "/?prompt=hello",
    );
    assert.equal(
      routes.mapBrowserPathToInitialRoute("/projects", "?projectId=abc")
        .memoryPath,
      "/projects?projectId=abc",
    );
    assert.equal(
      routes.mapBrowserPathToInitialRoute("/thread/abc", "?view=review")
        .memoryPath,
      "/local/abc?view=review",
    );
    assert.deepEqual(
      routes.mapMemoryPathToBrowserPath("/local/abc", "?view=review", "#diff"),
      { path: "/thread/abc?view=review#diff" },
    );
    assert.equal(
      routes.mapMemoryPathToBrowserPath("/projects", "?projectId=abc").path,
      "/projects?projectId=abc",
    );
    window.location = { pathname: "/thread/abc", search: "?view=review" };
    handlers.popstate();
    assert.equal(window.lastEvent.data.path, "/local/abc?view=review");
    assert.equal(
      routes.mapBrowserPathToInitialRoute("/thread/%E0", "").memoryPath,
      "/",
    );
    assert.equal(
      routes.mapBrowserPathToInitialRoute("/share/receive", "?text=hello")
        .browserPath,
      "/codex",
    );
  });
  test("blocked products cannot be opened by URL, command, or history; Codex auth remains allowed", () => {
    enabled(true);
    for (const path of [
      "/chatgpt/quick-chat",
      "/chat",
      "/work",
      "/c/abc",
      "/gpts",
      "/sites",
      "/library",
      "/finance",
      "/settings/voice",
      "/%63hatgpt/quick-chat",
    ])
      assert.equal(policy.isCodexRoute(path), false, path);
    for (const path of [
      "/local/abc",
      "/remote/abc",
      "/projects",
      "/settings/account",
      "/settings/usage",
      "/settings/agent",
      "/login",
      "/auth/callback",
      "/connector/oauth_callback",
      "/checkout/web",
      "/codex-access",
      "/mcp-app/server/tool",
    ])
      assert.equal(policy.isCodexRoute(path), true, path);
    const target = {
      pathname: "/library",
      state: { x: 1 },
      search: "?x=1",
      hash: "#id",
    };
    assert.deepEqual(policy.normalizeRoute(target), {
      ...target,
      pathname: "/",
      search: "",
      hash: "",
    });
    assert.deepEqual(routes.mapBrowserPathToInitialRoute("/chatgpt", ""), {
      memoryPath: "/",
      browserPath: "/codex",
    });
    const calls = [];
    const h = {
      push(...args) {
        calls.push(["push", this, ...args]);
      },
      replace(...args) {
        calls.push(["replace", this, ...args]);
      },
    };
    policy.guardHistory(h);
    const push = h.push;
    policy.guardHistory(h);
    assert.equal(push, h.push);
    h.push("/work", { keep: true });
    h.replace("/local/abc", { keep: true });
    assert.deepEqual(
      calls.map((c) => [c[0], c[2], c[3]]),
      [
        ["push", "/", { keep: true }],
        ["replace", "/local/abc", { keep: true }],
      ],
    );
    assert.equal(calls[0][1], h);
    for (const id of [
      "switchToMode1",
      "switchToMode2",
      "quickChat",
      "openAvatarOverlay",
    ])
      assert.equal(policy.codexOnlyUi.isCommandAllowed({ id }), false);
    assert.equal(
      policy.codexOnlyUi.isCommandAllowed({
        id: "newProjectlessTask",
        commandMenuFeature: "codex",
      }),
      true,
    );
    assert.deepEqual(
      policy.codexOnlyUi
        .filterDestinations([
          { id: "builtin:projects" },
          { id: "builtin:sites" },
          { id: "builtin:agents" },
          { id: "builtin:pull-requests" },
        ])
        .map((x) => x.id),
      ["builtin:projects", "builtin:pull-requests"],
    );
    assert.deepEqual(
      policy.codexOnlyUi
        .filterSettings([
          { slug: "account" },
          { slug: "voice" },
          { slug: "agent" },
        ])
        .map((x) => x.slug),
      ["account", "agent"],
    );
  });
  test("UI branding preserves ICU arguments, injected content and original catalogs", () => {
    enabled(true);
    const catalog = {
      "settings.permission": [
        { type: 0, value: "ChatGPT reads " },
        { type: 1, value: "ChatGPTArgument" },
      ],
      "sidebar.title": "Archived chats",
      "account.plan": "ChatGPT Pro",
    };
    const result = policy.brandMessages(catalog);
    assert.equal(result["settings.permission"][0].value, "Codex reads ");
    assert.equal(result["settings.permission"][1].value, "ChatGPTArgument");
    assert.equal(result["sidebar.title"], "Archived threads");
    assert.equal(result["account.plan"], "Pro");
    assert.equal(catalog["settings.permission"][0].value, "ChatGPT reads ");
    assert.equal(policy.brandMessages(catalog), result);
    const descriptor = {
      id: "settings.label",
      defaultMessage: "ChatGPT works with {project}",
    };
    assert.equal(
      policy.brandDescriptor(descriptor).defaultMessage,
      "Codex works with {project}",
    );
    enabled(false);
    assert.equal(policy.brandMessages(catalog), catalog);
    assert.equal(policy.brandDescriptor(descriptor), descriptor);
  });
} finally {
  await rm(output, { recursive: true, force: true });
}
