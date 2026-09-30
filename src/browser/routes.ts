import { codexOnlyMode, isCodexRoute } from "./codex-only";

export function mapBrowserPathToInitialRoute(pathname: string, search: string) {
  if (pathname === "/share/receive" && search) {
    const params = new URLSearchParams(search);

    const prompt = ["title", "text", "url"]
      .flatMap((name) => {
        const value = params.get(name);
        return value === null ? [] : [`${name}: ${value}`];
      })
      .join("\n");

    return {
      memoryPath: prompt
        ? `/?${new URLSearchParams({ prompt }).toString()}`
        : "/",
      browserPath: codexOnlyMode() ? "/codex" : "/",
    };
  }

  return {
    memoryPath:
      mapBrowserPathToRoute(pathname) + (codexOnlyMode() ? search : ""),
    ...(codexOnlyMode() &&
    !isCodexRoute(pathname) &&
    pathname !== "/codex" &&
    !/^\/thread\/[^/]+$/.test(pathname)
      ? { browserPath: "/codex" }
      : {}),
  };
}

function mapBrowserPathToRoute(pathname: string): string {
  const match = pathname.match(/^\/thread\/([^/]+)$/);
  if (match) {
    try {
      return `/local/${decodeURIComponent(match[1])}`;
    } catch {
      return "/";
    }
  }

  if (codexOnlyMode() && pathname !== "/codex" && isCodexRoute(pathname))
    return pathname;
  return "/";
}

export function mapMemoryPathToBrowserPath(
  pathname: string,
  search = "",
  hash = "",
) {
  const suffix = codexOnlyMode() ? search + hash : "";
  if (pathname === "/") {
    return {
      path: (codexOnlyMode() ? "/codex" : "/") + suffix,
      titleChange: "Codex",
    };
  }

  const match = pathname.match(/^\/local\/([^/?#]+)$/);
  if (!match) {
    return codexOnlyMode() && isCodexRoute(pathname)
      ? { path: pathname + suffix, titleChange: "Codex" }
      : null;
  }

  return { path: `/thread/${encodeURIComponent(match[1])}${suffix}` };
}

export function dispatchNavigateToRoute(path: string): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "navigate-to-route",
        path,
      },
    }),
  );
}

window.addEventListener("popstate", () => {
  if (!codexOnlyMode()) {
    dispatchNavigateToRoute(mapBrowserPathToRoute(window.location.pathname));
    return;
  }
  const route = mapBrowserPathToInitialRoute(
    window.location.pathname,
    window.location.search,
  );
  dispatchNavigateToRoute(route.memoryPath);
});
