import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import Fastify from "fastify";
const require = createRequire(import.meta.url);
const {
  registerWorkspaceDirectory,
} = require("../src/server/workspace-directory.js");

test("folder creation supports Unicode, rejects traversal and preserves existing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-folders-"));
  const app = Fastify();
  await registerWorkspaceDirectory(app);
  const create = (name, parent = root) =>
    app.inject({
      method: "POST",
      url: "/__backend/directories",
      payload: { parent, name },
    });
  try {
    const result = await create(" 我的项目 ");
    assert.equal(result.statusCode, 201);
    assert.equal(result.json().path, join(root, "我的项目"));
    assert.ok((await stat(result.json().path)).isDirectory());
    assert.equal((await create("我的项目")).statusCode, 409);
    await writeFile(join(root, "existing"), "keep me");
    assert.equal((await create("existing")).statusCode, 409);
    assert.equal(await readFile(join(root, "existing"), "utf8"), "keep me");
    for (const name of [
      "",
      " ",
      ".",
      "..",
      "../outside",
      "/absolute",
      "nested/folder",
      "nested\\folder",
      "bad\0name",
    ]) {
      assert.equal((await create(name)).statusCode, 400, name);
    }
    assert.equal((await create("test", join(root, "missing"))).statusCode, 404);
    assert.equal(
      (await create("test", join(root, "existing"))).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/__backend/directories",
          payload: { name: "test" },
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
