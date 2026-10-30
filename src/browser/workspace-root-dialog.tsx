import {
  QueryClient,
  QueryClientProvider,
  keepPreviousData,
  useQuery,
} from "@tanstack/react-query";
import React, { FormEvent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CloseIcon, FolderIcon, UpIcon } from "./icons";

export type WorkspaceDirectoryEntry = {
  name: string;
  path: string;
};

export type WorkspaceDirectoryEntries = {
  directoryPath: string;
  parentPath: string | null;
  entries: WorkspaceDirectoryEntry[];
};

const TITLE_ID = "codex-web-workspace-root-dialog-title";
const DESCRIPTION_ID = "codex-web-workspace-root-dialog-description";

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function WorkspaceRootDialog({
  listDirectory,
  onClose,
}: WorkspaceRootDialogOptions & {
  onClose: (value: string | null) => void;
}): React.ReactElement {
  const [directoryPath, setDirectoryPath] = useState<string | null>(null);
  const [userSelectedPath, setUserSelectedPath] = useState<string | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const directoryQuery = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => listDirectory(directoryPath),
    queryKey: ["workspace-directory-entries", directoryPath],
  });
  const entries = directoryQuery.data?.entries ?? [];
  const parentPath = directoryQuery.data?.parentPath ?? null;
  const isBusy = directoryQuery.isFetching || creating;
  const isLoading = directoryQuery.isPending && !directoryQuery.data;
  const queryError = directoryQuery.isError
    ? errorMessage(directoryQuery.error)
    : null;

  function navigateTo(nextDirectoryPath: string): void {
    if (creating) return;
    setShowNewFolder(false);
    setCreateError(null);
    setUserSelectedPath(nextDirectoryPath);
    setDirectoryPath(nextDirectoryPath);
  }

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const selectedPath = userSelectedPath ?? directoryQuery.data?.directoryPath;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    event.stopPropagation();
    if (showNewFolder) {
      void createFolder();
      return;
    }
    if (selectedPath && !isBusy && !queryError) {
      onClose(selectedPath);
    }
  }

  const selectedPathValue = selectedPath ?? "";

  async function createFolder(): Promise<void> {
    const parent = directoryQuery.data?.directoryPath;
    if (!parent || isBusy || !newFolderName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch("/__backend/directories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent, name: newFolderName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "创建文件夹失败");
      await directoryQuery.refetch();
      setUserSelectedPath(result.path);
      setNewFolderName("");
      setShowNewFolder(false);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "创建文件夹失败，请重试",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div
        aria-hidden="true"
        className="extension:bg-token-editor-background/80 electron:bg-[#00000022] codex-dialog-overlay fixed inset-0 z-50"
        data-state="open"
        onClick={() => onClose(null)}
        style={{ pointerEvents: "auto" }}
      />
      <div
        aria-describedby={DESCRIPTION_ID}
        aria-labelledby={TITLE_ID}
        aria-modal="true"
        className="codex-dialog left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none fixed bg-token-dropdown-background/90 text-token-foreground max-w-[92vw] rounded-3xl ring-[0.5px] ring-token-border shadow-lg backdrop-blur-xl w-[520px]"
        data-state="open"
        ref={dialogRef}
        role="dialog"
        style={{ pointerEvents: "auto" }}
        tabIndex={-1}
      >
        <form className="flex flex-col gap-0" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-0 px-5 py-5 text-base leading-normal tracking-normal">
            <div className="flex w-full flex-col pt-3 first:pt-0">
              <div className="flex flex-col items-start gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1 self-stretch">
                  <div
                    className="heading-dialog min-w-0 font-semibold"
                    id={TITLE_ID}
                  >
                    选择项目文件夹
                  </div>
                  <div className="sr-only" id={DESCRIPTION_ID}>
                    选择或新建服务器上的项目文件夹。
                  </div>
                </div>
              </div>
            </div>

            <div className="flex w-full flex-col pt-3 first:pt-0 gap-2">
              <label className="flex flex-col gap-0.5">
                <span className="font-medium text-token-text-primary">
                  选择文件夹
                </span>
                <div className="flex h-70 min-h-56 flex-col gap-3">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="mt-1 mb-2 flex min-w-0 items-center gap-1">
                      <button
                        aria-label="上级目录"
                        className="border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-full text-token-description-foreground enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent h-token-button-composer-sm px-1.5 py-0 text-sm leading-[18px] aspect-square items-center justify-center !px-0 shrink-0"
                        disabled={!parentPath || isBusy}
                        onClick={() => {
                          if (parentPath) {
                            navigateTo(parentPath);
                          }
                        }}
                        type="button"
                      >
                        <UpIcon />
                      </button>
                      <input
                        aria-label="选中的文件夹路径"
                        className="w-full min-w-0 flex-1 rounded-md border border-token-input-border bg-token-input-background px-2.5 py-1.5 text-sm text-token-input-foreground outline-none disabled:bg-token-foreground/5 disabled:text-token-text-secondary disabled:opacity-100"
                        disabled
                        readOnly
                        spellCheck={false}
                        title={selectedPathValue}
                        value={selectedPathValue}
                      />
                      <button
                        type="button"
                        disabled={
                          isBusy || !directoryQuery.data || !!queryError
                        }
                        className="shrink-0 rounded-md border px-2.5 py-1.5 text-sm disabled:opacity-40"
                        onClick={() => {
                          setShowNewFolder(true);
                          setCreateError(null);
                        }}
                      >
                        新建文件夹
                      </button>
                    </div>

                    {showNewFolder && (
                      <div className="mb-2 flex flex-col gap-2 rounded-md border p-2">
                        <span className="text-sm">
                          在 {directoryQuery.data?.directoryPath} 中创建
                        </span>
                        <input
                          autoFocus
                          aria-label="新文件夹名称"
                          placeholder="输入文件夹名称"
                          className="w-full rounded-md border bg-token-input-background px-2.5 py-1.5 text-sm"
                          value={newFolderName}
                          disabled={creating}
                          maxLength={255}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.stopPropagation();
                              void createFolder();
                            }
                          }}
                          onChange={(event) => {
                            setNewFolderName(event.target.value);
                            setCreateError(null);
                          }}
                        />
                        {createError && (
                          <div
                            role="alert"
                            className="text-sm text-token-text-error"
                          >
                            {createError}
                          </div>
                        )}
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={creating}
                            onClick={() => {
                              setShowNewFolder(false);
                              setCreateError(null);
                            }}
                          >
                            取消新建
                          </button>
                          <button
                            type="button"
                            disabled={isBusy || !newFolderName.trim()}
                            onClick={() => void createFolder()}
                          >
                            {creating ? "正在创建…" : "创建文件夹"}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="min-h-0 flex-1 bg-token-input-background border-token-input-border flex overflow-y-auto rounded-lg border">
                      <div className="flex w-full flex-col py-1">
                        {isLoading ? (
                          <div className="px-3 py-2 text-sm text-token-description-foreground">
                            Loading...
                          </div>
                        ) : queryError ? (
                          <div className="px-3 py-2 text-sm text-token-text-error">
                            {queryError}
                          </div>
                        ) : entries.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-token-description-foreground">
                            No folders
                          </div>
                        ) : (
                          entries.map((entry) => {
                            const selected = entry.path === selectedPath;
                            return (
                              <button
                                className={[
                                  "flex",
                                  "w-full",
                                  "min-w-0",
                                  "self-stretch",
                                  "items-center",
                                  "gap-2",
                                  "px-3",
                                  "py-1.5",
                                  "text-left",
                                  "text-sm",
                                  "hover:bg-token-foreground/5",
                                  selected
                                    ? "bg-token-list-hover-background"
                                    : "",
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                data-path={entry.path}
                                key={entry.path}
                                onClick={() => {
                                  setUserSelectedPath(entry.path);
                                }}
                                onDoubleClick={() => {
                                  navigateTo(entry.path);
                                }}
                                title={entry.path}
                                type="button"
                              >
                                <FolderIcon />
                                <span className="truncate">{entry.name}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </label>
            </div>

            <div className="flex w-full flex-col pt-3 first:pt-0">
              <div className="flex w-full items-center justify-end gap-3">
                <button
                  className="border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg text-token-description-foreground enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent px-4 py-1.5 text-base leading-[18px]"
                  onClick={() => onClose(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-lg bg-token-foreground enabled:hover:bg-token-foreground/80 data-[state=open]:bg-token-foreground/80 text-token-dropdown-background px-4 py-1.5 text-base leading-[18px]"
                  disabled={
                    !selectedPath || isBusy || !!queryError || showNewFolder
                  }
                  type="submit"
                >
                  选择文件夹
                </button>
              </div>
            </div>
          </div>
        </form>

        <button
          aria-label="Close"
          className="no-drag absolute top-4 right-4 cursor-interaction rounded p-1 leading-none text-token-foreground/80 hover:bg-token-toolbar-hover-background focus:ring-1 focus:ring-token-focus-border focus:outline-none"
          onClick={() => onClose(null)}
          type="button"
        >
          <CloseIcon />
        </button>
      </div>
    </>
  );
}

function ensureHost(): HTMLElement {
  const DIALOG_ID = "codex-web-workspace-root-dialog";
  let element = document.getElementById(DIALOG_ID);
  if (!element) {
    element = document.createElement("div");
    element.id = DIALOG_ID;
  }
  // Keep the picker inside an existing modal's focus/pointer boundary.
  const parentDialog = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"]'),
  ).findLast((dialog) => !element!.contains(dialog));
  (parentDialog ?? document.body).append(element);
  return element;
}

type WorkspaceRootDialogOptions = {
  listDirectory: (
    directoryPath: string | null,
  ) => Promise<WorkspaceDirectoryEntries>;
};

export async function openSelectWorkspaceRootDialog({
  listDirectory,
}: WorkspaceRootDialogOptions): Promise<string | null> {
  const activeElement = document.activeElement;

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  let resolveFn!: (target: string | null) => void;
  const promise = new Promise<string | null>((resolve) => {
    resolveFn = resolve;
  });

  const host = ensureHost();
  const parentDialog = host.closest<HTMLElement>('[role="dialog"]');
  const parentOverflow = parentDialog?.style.overflow ?? "";
  const parentBackdropFilter = parentDialog?.style.backdropFilter ?? "";
  if (parentDialog) {
    // A backdrop filter makes fixed children relative to the parent dialog;
    // its overflow would otherwise clip the taller folder picker.
    parentDialog.style.overflow = "visible";
    parentDialog.style.backdropFilter = "none";
  }
  const reactRoot = createRoot(host);
  reactRoot.render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceRootDialog listDirectory={listDirectory} onClose={resolveFn} />
    </QueryClientProvider>,
  );

  const result = await promise;

  reactRoot.unmount();
  if (parentDialog) {
    parentDialog.style.overflow = parentOverflow;
    parentDialog.style.backdropFilter = parentBackdropFilter;
  }

  if (activeElement instanceof HTMLElement) {
    activeElement.focus();
  }

  return result;
}
