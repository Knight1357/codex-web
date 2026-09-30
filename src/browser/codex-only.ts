/** UI policy only: never overrides account capabilities, IPC, or agent permissions. */
export const codexOnlyMode = () =>
  window.__CODEX_WEB_CONFIG__?.codexOnlyMode === true;

declare global {
  interface Window {
    __CODEX_WEB_CONFIG__?: { codexOnlyMode: boolean };
  }
}

const destinations = new Set([
  "builtin:projects",
  "builtin:pull-requests",
  "builtin:automations",
  "builtin:archive",
  "builtin:skills",
  "builtin:security",
  "builtin:activity",
]);
const excludedSettings = new Set([
  "voice",
  "pets",
  "chronicle",
  "appshots",
  "personalization",
  "consumer-view",
  "import",
  "profile",
  "analytics",
]);
const routeRoots = new Set([
  "projects",
  "local",
  "remote",
  "settings",
  "codex-access",
  "plugins",
  "skills",
  "pull-requests",
  "automations",
  "security",
  "archive",
  "remote-connections",
  "mcp-app",
  "hotkey-window",
  "login",
  "welcome",
  "select-workspace",
  "auth",
  "oauth",
  "connector",
  "checkout",
  "pricing-plan",
  "workspace-settings",
]);

export function isCodexRoute(path: string): boolean {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(path, "http://codex.local").pathname);
  } catch {
    return false;
  }
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  if (segments[0] === "settings" && excludedSettings.has(segments[1] ?? ""))
    return false;
  return routeRoots.has(segments[0]!);
}

export function normalizeRoute<
  T extends string | { pathname?: string; search?: string; hash?: string },
>(target: T): T | string {
  if (!codexOnlyMode()) return target;
  const path = typeof target === "string" ? target : (target.pathname ?? "/");
  if (isCodexRoute(path)) return target;
  return typeof target === "string"
    ? "/"
    : { ...target, pathname: "/", search: "", hash: "" };
}

type Target = string | { pathname?: string; search?: string; hash?: string };
type MemoryHistory = {
  push: (target: Target, ...args: unknown[]) => unknown;
  replace: (target: Target, ...args: unknown[]) => unknown;
};
const guarded = new WeakSet<object>();
export function guardHistory(history: MemoryHistory): void {
  if (!codexOnlyMode() || guarded.has(history)) return;
  guarded.add(history);
  for (const method of ["push", "replace"] as const) {
    const original = history[method];
    history[method] = function (target, ...args) {
      return original.call(this, normalizeRoute(target), ...args);
    };
  }
}

export const codexOnlyUi = {
  normalizeRoute,
  guardHistory,
  filterDestinations<T extends { id: string }>(items: T[]): T[] {
    return codexOnlyMode()
      ? items.filter((item) => destinations.has(item.id))
      : items;
  },
  filterSettings<T extends { slug: string }>(items: T[]): T[] {
    return codexOnlyMode()
      ? items.filter((item) => !excludedSettings.has(item.slug))
      : items;
  },
  isCommandAllowed(command: {
    id?: string;
    commandMenuFeature?: string;
  }): boolean {
    if (!codexOnlyMode()) return true;
    return (
      command.commandMenuFeature !== "chatgpt" &&
      !/switchToMode[12]$|quickChat|openAvatarOverlay|library|gpts|finance|sites|workspaceAgent/i.test(
        command.id ?? "",
      )
    );
  },
};

// Brand only UI message literals, before interpolation. User content, model output,
// OAuth URLs, account identifiers, and injected message values stay untouched.
const brandedCatalogs = new WeakMap<object, Record<string, unknown>>();
function brandLiteral(text: string, id: string): string {
  let result = text
    .replace(/ChatGPT (Plus|Pro|Business|Enterprise)/g, "$1")
    .replace(/ChatGPT/g, "Codex");
  if (/^(sidebar|settings)/i.test(id)) {
    result = result
      .replace(/\bChats\b/g, "Threads")
      .replace(/\bchats\b/g, "threads")
      .replace(/\bChat\b/g, "Thread")
      .replace(/\bchat\b/g, "thread");
  }
  return result;
}
function brandMessageValue(value: unknown, id: string): unknown {
  if (typeof value === "string") return brandLiteral(value, id);
  if (Array.isArray(value))
    return value.map((node) => brandMessageValue(node, id));
  if (value && typeof value === "object") {
    // FormatJS AST literal nodes only; argument names/selectors are protocol data.
    const node = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(node).map(([key, field]) => [
        key,
        key === "value" && node.type === 0 && typeof field === "string"
          ? brandLiteral(field, id)
          : typeof field === "object"
            ? brandMessageValue(field, id)
            : field,
      ]),
    );
  }
  return value;
}
export function brandMessages(
  messages: Record<string, unknown>,
): Record<string, unknown> {
  if (!codexOnlyMode()) return messages;
  let result = brandedCatalogs.get(messages);
  if (!result) {
    result = Object.fromEntries(
      Object.entries(messages).map(([id, value]) => [
        id,
        brandMessageValue(value, id),
      ]),
    );
    brandedCatalogs.set(messages, result);
  }
  return result;
}
export function brandDescriptor<
  T extends { id?: string; defaultMessage?: unknown },
>(descriptor: T): T {
  if (!codexOnlyMode()) return descriptor;
  return {
    ...descriptor,
    defaultMessage: brandMessageValue(
      descriptor.defaultMessage,
      descriptor.id ?? "",
    ),
  };
}
