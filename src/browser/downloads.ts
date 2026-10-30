// Keep source-code links available to the editor; deliverables and links labelled
// as downloads should use the browser's native download manager instead.
export function localDownloadPath(
  href: string,
  label = "",
  download = false,
): string | null {
  let filename = href;
  const sandbox = filename.startsWith("sandbox:");
  if (sandbox) filename = filename.slice(8);
  if (filename.startsWith("file:")) {
    try {
      const url = new URL(filename);
      if (url.hostname && url.hostname !== "localhost") return null;
      filename = url.pathname;
    } catch {
      return null;
    }
  }
  if (
    !filename.startsWith("/") ||
    filename.startsWith("//") ||
    filename.startsWith("/__backend/")
  )
    return null;
  try {
    filename = decodeURIComponent(filename);
  } catch {
    return null;
  }
  if (filename.includes("\0") || /:\d+(?::\d+)?$/.test(filename)) return null;
  return sandbox ||
    download ||
    /下载|\bdownload\b/i.test(label) ||
    /\.(mlx|mat|pdf|zip|tar|gz|7z|xlsx?|csv|docx?|pptx?|png|jpe?g|webp|gif|mp4|mp3|wav|ipynb)$/i.test(
      filename,
    )
    ? filename
    : null;
}

export function installFileDownloads(): void {
  const handleActivation = (event: MouseEvent | KeyboardEvent) => {
    if (
      event instanceof KeyboardEvent &&
      event.key !== "Enter" &&
      event.key !== " "
    )
      return;
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLElement>(
      "a[href], [data-file-reference][data-prompt-link-href]",
    );
    if (!anchor) return;
    const filename = localDownloadPath(
      anchor.getAttribute("data-prompt-link-href") ??
        anchor.getAttribute("href") ??
        "",
      anchor.getAttribute("data-prompt-link-label") ?? anchor.textContent ?? "",
      anchor.hasAttribute("download"),
    );
    if (!filename) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void downloadFile(filename);
  };
  document.addEventListener("click", handleActivation, true);
  document.addEventListener("keydown", handleActivation, true);
}

async function downloadFile(filename: string): Promise<void> {
  // Check the file first so an error is visible in the conversation's tab. Then
  // stream the GET directly to the download manager without buffering big files.
  const url = `/__backend/download?${new URLSearchParams({ path: filename })}`;
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? "文件不存在，可能已被移动或删除，请让 Codex 重新生成文件。"
          : "下载失败，请检查文件路径和读取权限后重试。",
      );
    }
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.split("/").pop() ?? "download";
    document.body.append(link);
    link.click();
    link.remove();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "下载失败，请重试。");
  }
}
