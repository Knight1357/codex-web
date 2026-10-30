import path from "node:path";
import { open } from "node:fs/promises";
import type { FastifyInstance } from "fastify";

// Files live on the same machine as the CLI, not in the browser filesystem.
export async function registerFileDownload(app: FastifyInstance) {
  app.get<{ Querystring: { path: string } }>(
    "/__backend/download",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["path"],
          additionalProperties: false,
          properties: { path: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const filename = request.query.path;
      if (!path.isAbsolute(filename) || filename.includes("\0")) {
        return reply.code(400).send({ error: "下载路径必须是绝对文件路径" });
      }
      let file;
      try {
        file = await open(filename, "r");
        const info = await file.stat();
        if (!info.isFile()) {
          await file.close();
          return reply.code(400).send({ error: "只能下载文件，不能下载目录" });
        }
        const encoded = encodeURIComponent(path.basename(filename)).replace(
          /['()*]/g,
          (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
        );
        return reply
          .type("application/octet-stream")
          .header("X-Content-Type-Options", "nosniff")
          .header("Content-Length", info.size)
          .header(
            "Content-Disposition",
            `attachment; filename="download"; filename*=UTF-8''${encoded}`,
          )
          .send(file.createReadStream());
      } catch (error) {
        await file?.close().catch(() => {});
        const code = (error as NodeJS.ErrnoException).code;
        return reply
          .code(code === "ENOENT" || code === "ENOTDIR" ? 404 : 403)
          .send({
            error:
              code === "ENOENT" || code === "ENOTDIR"
                ? "文件不存在，可能已被移动或删除，请让 Codex 重新生成文件"
                : "无法读取该文件，请检查文件权限",
          });
      }
    },
  );
}
