import path from "node:path";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

export async function registerWebAssets(app: FastifyInstance, root: string) {
  await app.register(fastifyStatic, {
    root,
    prefix: "/",
    preCompressed: true,
    cacheControl: false,
    setHeaders(response, filename) {
      response.setHeader("Vary", "Accept-Encoding");
      // Patched upstream bundles retain their filenames between builds.
      // Revalidate instead of marking those URLs immutable.
      const isAsset = path
        .relative(root, filename)
        .startsWith(`assets${path.sep}`);
      response.setHeader(
        "Cache-Control",
        isAsset ? "private, no-cache" : "no-store",
      );
    },
  });
}
