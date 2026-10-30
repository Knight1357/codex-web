import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

export async function createWorkspaceDirectory(parent: string, name: string) {
  const trimmed = name.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    /[/\\\x00]/.test(trimmed)
  ) {
    throw new TypeError("请输入有效的文件夹名称，不能包含路径分隔符");
  }
  const directory = path.resolve(parent);
  if (!(await fs.stat(directory)).isDirectory())
    throw new TypeError("父路径不是文件夹");
  const created = path.join(directory, trimmed);
  await fs.mkdir(created);
  return { path: created };
}

export async function registerWorkspaceDirectory(app: FastifyInstance) {
  app.post<{ Body: { parent: string; name: string } }>(
    "/__backend/directories",
    {
      schema: {
        body: {
          type: "object",
          required: ["parent", "name"],
          additionalProperties: false,
          properties: {
            parent: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1, maxLength: 255 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            await createWorkspaceDirectory(
              request.body.parent,
              request.body.name,
            ),
          );
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const status =
          error instanceof TypeError
            ? 400
            : code === "EEXIST"
              ? 409
              : code === "EACCES" || code === "EPERM"
                ? 403
                : code === "ENOENT" || code === "ENOTDIR"
                  ? 404
                  : 500;
        const message =
          code === "EEXIST"
            ? "同名文件或文件夹已存在，请换一个名称"
            : status === 403
              ? "没有在此目录下创建文件夹的权限"
              : status === 404
                ? "父目录不存在或已被移动，请刷新后重试"
                : error instanceof TypeError
                  ? error.message
                  : "创建文件夹失败，请重试";
        return reply.code(status).send({ error: message });
      }
    },
  );
}
