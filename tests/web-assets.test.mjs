import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, brotliDecompressSync } from "node:zlib";
import Fastify from "fastify";
import { compressAssets } from "../scripts/compress-assets.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { registerWebAssets } = require("../src/server/web-assets.js");

test("real static responses negotiate compression, revalidate, and update after rebuild", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-web-assets-"));
  const app = Fastify();
  try {
    await mkdir(join(root, "assets"));
    const filename = join(root, "assets", "app.js");
    const source = "console.log('compressed asset');\n".repeat(1000);
    await writeFile(filename, source);
    await writeFile(join(root, "index.html"), "<html>App</html>");
    await writeFile(join(root, "assets", "small.js"), "export default 1;");
    await compressAssets(root);
    await registerWebAssets(app, root);
    app.get("/__backend/ui-config.js", async (_request, reply) =>
      reply.header("Cache-Control", "no-store").send("window.config={}"),
    );
    const request = (headers = {}) =>
      app.inject({ url: "/assets/app.js", headers });
    const plain = await request();
    assert.equal(plain.body, source);
    assert.equal(plain.headers["cache-control"], "private, no-cache");
    assert.equal(plain.headers.vary, "Accept-Encoding");
    for (const [encoding, decompress] of [
      ["gzip", gunzipSync],
      ["br", brotliDecompressSync],
    ]) {
      const response = await request({ "accept-encoding": encoding });
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["content-encoding"], encoding);
      assert.match(response.headers["content-type"], /javascript/);
      assert.equal(decompress(response.rawPayload).toString(), source);
      assert.ok(response.rawPayload.length < plain.rawPayload.length / 2);
      const cached = await request({
        "accept-encoding": encoding,
        "if-none-match": response.headers.etag,
      });
      assert.equal(cached.statusCode, 304);
      assert.equal(cached.rawPayload.length, 0);
      assert.equal(cached.headers.vary, "Accept-Encoding");
      assert.equal(cached.headers["cache-control"], "private, no-cache");
    }
    const head = await app.inject({
      method: "HEAD",
      url: "/assets/app.js",
      headers: { "accept-encoding": "gzip" },
    });
    assert.equal(head.statusCode, 200);
    assert.equal(head.headers["content-encoding"], "gzip");
    assert.equal(head.rawPayload.length, 0);
    const html = await app.inject("/");
    assert.equal(html.headers["cache-control"], "no-store");
    const dynamic = await app.inject("/__backend/ui-config.js");
    assert.equal(dynamic.headers["cache-control"], "no-store");
    const small = await app.inject({
      url: "/assets/small.js",
      headers: { "accept-encoding": "br,gzip" },
    });
    assert.equal(small.body, "export default 1;");
    assert.equal(small.headers["content-encoding"], undefined);
    const previous = await request({ "accept-encoding": "gzip" });
    const updated = source + "console.log('new release');\n";
    await writeFile(filename, updated);
    await compressAssets(root);
    const fresh = await request({
      "accept-encoding": "gzip",
      "if-none-match": previous.headers.etag,
    });
    assert.equal(fresh.statusCode, 200);
    assert.equal(gunzipSync(fresh.rawPayload).toString(), updated);
    await writeFile(filename, "small");
    await compressAssets(root);
    await assert.rejects(readFile(filename + ".gz"), { code: "ENOENT" });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
