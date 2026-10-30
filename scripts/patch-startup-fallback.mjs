import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function patchStartup(source) {
  if (source.includes("codex-web: optional Statsig fallback")) return source;
  const bootstrap = "let t = await cUo(e);";
  const seed = "e.dataAdapter.setData(t.statsigPayload),";
  if (!source.includes(bootstrap) || !source.includes(seed))
    throw new Error("Statsig startup patch no longer matches upstream");
  return source.replace(bootstrap, `let t = await cUo(e).catch((error) => {
    // codex-web: optional Statsig fallback
    if (!window.__ELECTRON_SHIM__?.codexOnlyMode) throw error;
    return {
      user: { userID: e.stableId ?? e.appSessionId,
        customIDs: { stableID: e.stableId ?? e.appSessionId } },
      statsigPayload: null,
    };
  });`).replace(seed, "t.statsigPayload != null && e.dataAdapter.setData(t.statsigPayload),");
}

export async function patchStartupAssets(root = "scratch/asar/webview/assets") {
  let count = 0;
  for (const name of await readdir(root)) {
    if (!/^app-(initial|primary)-.*\.js$/.test(name)) continue;
    const file = join(root, name);
    const source = await readFile(file, "utf8");
    if (!source.includes("let t = await cUo(e);") && !source.includes("codex-web: optional Statsig fallback")) continue;
    await writeFile(file, patchStartup(source));
    count++;
  }
  if (!count) throw new Error("Statsig startup bundle not found");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await patchStartupAssets(process.argv[2]);
