import {
  readdir,
  readFile,
  writeFile,
  stat,
  utimes,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzip, brotliCompress, constants } from "node:zlib";

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

export async function compressAssets(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (
        entry.isFile() &&
        /\.(js|css|html|json|svg|wasm)$/.test(entry.name)
      )
        files.push(filename);
    }
  }
  await visit(root);
  let count = 0;
  const queue = [...files];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const filename = queue.pop();
        const metadata = await stat(filename);
        const original = await readFile(filename);
        const variants =
          original.length < 1024
            ? [null, null]
            : await Promise.all([
                gzipAsync(original, { level: 9 }),
                brotliAsync(original, {
                  params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
                }),
              ]);
        for (const [index, extension] of [".gz", ".br"].entries()) {
          const target = filename + extension;
          const bytes = variants[index];
          if (bytes && bytes.length < original.length) {
            await writeFile(target, bytes);
            await utimes(target, metadata.atime, metadata.mtime);
            count++;
          } else {
            await rm(target, { force: true });
          }
        }
      }
    }),
  );
  return count;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? "scratch/asar/webview");
  console.log(
    `Prepared ${await compressAssets(root)} compressed static assets`,
  );
}
