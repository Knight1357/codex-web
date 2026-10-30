import { codexOnlyMode } from "./codex-only";

type Scope = {
  key: string;
  hostIds?: string[];
  materializationScopes?: Scope[];
  [key: string]: unknown;
};
type PageState = { hasMore: boolean; isLoading: boolean; hasError?: boolean };
type Reader = {
  hostIds: string[];
  getPageState(scope: Scope): PageState;
  getEntries(scope: Scope): readonly unknown[] | undefined;
  subscribe(listener: () => void): () => void;
  ensurePage(scope: Scope, size: number): Promise<void>;
  loadMore(scope: Scope, size: number): Promise<void>;
};

const scopes = new WeakMap<Scope, Scope>();
const failedState = Object.freeze({
  hasMore: false,
  isLoading: false,
  hasError: true,
});
const loadingState = Object.freeze({ hasMore: true, isLoading: true });

function hosts(ids: string[]): string[] {
  return codexOnlyMode()
    ? ids.filter((id) => id !== "chatgpt" && !id.startsWith("chatgpt:"))
    : ids;
}

function scope(value: Scope): Scope {
  if (!codexOnlyMode() || !value.hostIds) return value;
  let result = scopes.get(value);
  if (!result) {
    result = { ...value, hostIds: hosts(value.hostIds) };
    scopes.set(value, result);
  }
  return result;
}

function reader<T extends Reader>(target: T): T {
  if (!codexOnlyMode()) return target;
  const errors = new Map<string, number>();
  const pending = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const key = (value: Scope) => JSON.stringify(value);
  const count = (value: Scope) =>
    [value, ...(value.materializationScopes ?? [])].reduce(
      (total, value) => total + (target.getEntries(scope(value))?.length ?? 0),
      0,
    );
  const notify = () => {
    for (const listener of listeners) listener();
  };

  function run(
    method: "ensurePage" | "loadMore",
    value: Scope,
    size: number,
    retry = false,
  ): Promise<void> {
    const id = key(value);
    const active = pending.get(id);
    if (active) return active;
    if (errors.has(id) && !retry) return Promise.resolve();
    errors.delete(id);
    const before = count(value);
    const request = Promise.resolve()
      .then(async () => {
        await target[method](value, size);
        // An incomplete catalog can keep reporting more after sync has failed.
        // Stop automatic pagination if a completed attempt made no progress.
        if (
          method === "loadMore" &&
          target.getPageState(value).hasMore &&
          count(value) === before
        ) {
          throw new Error("Thread catalog pagination made no progress");
        }
      })
      .catch((error) => {
        errors.set(id, count(value));
        throw error;
      })
      .finally(() => {
        pending.delete(id);
        notify();
      });
    pending.set(id, request);
    notify();
    return request;
  }

  return new Proxy(target, {
    get(object, property) {
      if (property === "getEntries")
        return (value: Scope) => object.getEntries(scope(value));
      if (property === "getPageState")
        return (value: Scope) => {
          const id = key(value);
          const state = object.getPageState(value);
          if (errors.has(id)) {
            if (count(value) === errors.get(id) && state.hasMore)
              return failedState;
            errors.delete(id);
          }
          return pending.has(id) ? loadingState : state;
        };
      if (property === "subscribe")
        return (listener: () => void) => {
          listeners.add(listener);
          const unsubscribe = object.subscribe(listener);
          return () => {
            listeners.delete(listener);
            unsubscribe();
          };
        };
      if (property === "ensurePage" || property === "loadMore") {
        return (value: Scope, size: number) => run(property, value, size);
      }
      if (property === "retryPage")
        return (value: Scope, size: number) =>
          run("loadMore", value, size, true);
      const value = Reflect.get(object, property, object);
      // Upstream reader methods use native private fields and need their owner.
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
}

export const catalogPagination = { hosts, scope, reader };
