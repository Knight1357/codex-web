import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import Fastify from "fastify";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { registerFileDownload } = require("../src/server/file-download.js");

test("downloads preserve binary data and Unicode names, HEAD and missing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-download-"));
  const filename = join(root, "中文 文件 #1.mlx");
  const bytes = Buffer.from([80, 75, 3, 4, 0, 255, 128, 10]);
  await writeFile(filename, bytes);
  const app = Fastify();
  await registerFileDownload(app);
  const url = (path) => `/__backend/download?${new URLSearchParams({ path })}`;
  try {
    const response = await app.inject(url(filename));
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.rawPayload, bytes);
    assert.match(
      response.headers["content-disposition"],
      /attachment;.*filename\*=UTF-8''/,
    );
    assert.ok(
      response.headers["content-disposition"].includes(
        encodeURIComponent("中文 文件 #1.mlx"),
      ),
    );
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["content-type"], "application/octet-stream");
    const head = await app.inject({ method: "HEAD", url: url(filename) });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, "");
    assert.equal(Number(head.headers["content-length"]), bytes.length);
    assert.equal(
      (await app.inject(url(join(root, "missing")))).statusCode,
      404,
    );
    assert.equal((await app.inject(url(root))).statusCode, 400);
    assert.equal((await app.inject(url("relative.mlx"))).statusCode, 400);
    assert.equal((await app.inject(url("/bad\0name"))).statusCode, 400);
    assert.equal((await app.inject("/__backend/download")).statusCode, 400);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("download links distinguish generated files from editor and web links", async () => {
  const source = await readFile(
    new URL("../src/browser/downloads.ts", import.meta.url),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  });
  const { localDownloadPath } = await import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
  );
  assert.equal(
    localDownloadPath(
      "/workspace/sentry/deliverables/RAV_Figures123_AllInOne.mlx",
    ),
    "/workspace/sentry/deliverables/RAV_Figures123_AllInOne.mlx",
  );
  assert.equal(
    localDownloadPath("sandbox:/mnt/data/out.txt"),
    "/mnt/data/out.txt",
  );
  assert.equal(
    localDownloadPath("file:///workspace/%E4%B8%AD%E6%96%87.pdf"),
    "/workspace/中文.pdf",
  );
  assert.equal(
    localDownloadPath("/workspace/result.m", "下载 result.m"),
    "/workspace/result.m",
  );
  for (const href of [
    "https://example.com/a.pdf",
    "//example.com/a.pdf",
    "file://server/a.pdf",
    "/workspace/code.ts",
    "/workspace/code.ts:12",
    "/__backend/download?path=/a.pdf",
    "/codex",
    "javascript:alert(1)",
  ]) {
    assert.equal(localDownloadPath(href), null, href);
  }
});
