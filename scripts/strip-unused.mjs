import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

// Keep import/export contracts while removing the implementations of disabled products.
export async function stripUnused(root = "scratch/asar") {
  const assets = path.join(root, "webview/assets");
  let removed = 0;
  async function rewrite(file, visitor) {
    const source = await readFile(file, "utf8");
    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const edits = [];
    function walk(node) {
      visitor(node, ast, edits);
      ts.forEachChild(node, walk);
    }
    walk(ast);
    let output = source;
    for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0]))
      output = output.slice(0, start) + text + output.slice(end);
    removed += source.length - output.length;
    await writeFile(file, output);
  }
  const filenames = await readdir(assets);
  for (const name of filenames.filter((name) =>
    /^(app-initial-|app-primary-).*\.js$/.test(name),
  )) {
    await rewrite(path.join(assets, name), (node, ast, edits) => {
      if (ts.isFunctionDeclaration(node) && node.body) {
        const name = node.name?.text;
        if (name === "H9n")
          edits.push([
            node.body.getStart(ast),
            node.body.end,
            "{ return []; }",
          ]);
        if (name === "$on")
          edits.push([
            node.body.getStart(ast),
            node.body.end,
            '{ return { enabled: false, queryKey: ["disabled-referrals"], queryFn: async () => ({should_show:false}) }; }',
          ]);
      }
    });
  }
  for (const name of filenames.filter(name => /^(general-settings-|app-primary-).*\.js$/.test(name))) {
    await rewrite(path.join(assets, name), (node, ast, edits) => {
      if (ts.isFunctionDeclaration(node) && node.body) {
        const body = node.body.getText(ast);
        if (body.length < 18000 && (body.includes('sidebarCustomization.moreMenu') || /settings\.general\.(?:experimentalFeatures\.hotkeyWindowHotkey|popoutWindow|defaultTerminalLocation|power\.preventSleepWhileRunning)/.test(body))) {
          edits.push([node.body.getStart(ast), node.body.end, '{ return null; }']);
        }
      }
      if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'activity' && node.initializer.getText(ast).includes('_Tn')) {
        edits.push([node.initializer.getStart(ast), node.initializer.end, 'null']);
      }
    });
  }
  for (const name of filenames.filter((name) =>
    /^(entry-point-availability-|codex-app-home-beacon-announcement-state-).*\.js$/.test(
      name,
    ),
  )) {
    await rewrite(path.join(assets, name), (node, ast, edits) => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.body?.getText(ast).includes("/gift-credits/senders/eligibility")
      )
        edits.push([
          node.body.getStart(ast),
          node.body.end,
          "{ return Promise.resolve({eligible:false}); }",
        ]);
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText(ast) === "queryFn" &&
        node.initializer.getText(ast).includes("/beacons/home")
      )
        edits.push([
          node.initializer.getStart(ast),
          node.initializer.end,
          'async () => ({accountId:null,beacon:null,product:"codex",visitKey:null})',
        ]);
    });
  }
  for (const name of filenames.filter((name) =>
    /^(account-settings-|settings-154c5f83bf16|pets-settings-route-|chronicle-settings-page-|library-page-|unified-library-page-|avatar-overlay-quick-chat-bar-|pet-install-modal-host-|chatgpt-conversation-page-|gpt-discovery-page-|quick-chat-window-page-|avatar-overlay-native-page-|workspace-agents-page-|workspace-agent-detail-page-|appgen-page-|appgen-database-page-|appgen-settings-page-|global-dictation-page-|debug-window-page-|hotkey-window-home-page-|hotkey-window-new-thread-page-|hotkey-window-thread-page-|cloud-environments-settings-page-|local-environments-settings-page-|remote-connections-page-|automations-page-|skills-page-|plugins-page-|plugin-detail-page-|worktrees-settings-page-|hooks-settings-route-|pricing-page-|plan-summary-page-).*\.js$/.test(
      name,
    ),
  )) {
    const file = path.join(assets, name);
    const source = await readFile(file, "utf8");
    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const exports = [];
    for (const node of ast.statements) {
      if (
        ts.isExportDeclaration(node) &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      ) {
        for (const spec of node.exportClause.elements)
          exports.push(spec.name.text);
      }
    }
    if (!exports.length) throw Error("Cannot preserve exports: " + name);
    const output = exports
      .map(
        (name, index) =>
          `const disabled${index}=()=>null; export {disabled${index} as ${JSON.stringify(name)}};`,
      )
      .join("\n");
    removed += source.length - output.length;
    await writeFile(file, output);
  }
  for (const name of (await readdir(path.join(root, ".vite/build"))).filter(
    (name) => /^main-.*\.js$/.test(name),
  )) {
    await rewrite(path.join(root, ".vite/build", name), (node, ast, edits) => {
      if (
        ts.isMethodDeclaration(node) &&
        node.name.getText(ast) === "pollIfDue" &&
        node.body?.getText(ast).includes("primary_runtime_update_poll_failed")
      )
        edits.push([
          node.body.getStart(ast),
          node.body.end,
          "{ this.startupChecked = true; this.nextUpdateAtMs = null; }",
        ]);
    });
  }
  for (const name of filenames.filter(name => /^settings-page-.*\.js$/.test(name))) {
    await rewrite(path.join(assets, name), (node, ast, edits) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "Dn" && node.body?.getText(ast).includes("X.account.message")) {
        edits.push([node.body.getStart(ast), node.body.end, "{ return null; }"]);
      }
    });
  }
  let mapsRemoved = 0;
  for (const name of filenames.filter((name) => name.endsWith(".map"))) {
    await rm(path.join(assets, name), { force: true });
    mapsRemoved++;
  }
  console.log(`Removed ${mapsRemoved} unused browser source maps`);
  console.log(
    `Removed ${removed} characters of disabled product and updater implementations`,
  );
}
if (process.argv[1]?.endsWith("/strip-unused.mjs"))
  await stripUnused(process.argv[2]);
