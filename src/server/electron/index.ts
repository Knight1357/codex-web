// Keep native desktop API no-ops for calls made by the upstream app.
type StubFunction = (...args: unknown[]) => unknown;
type StubListener = (...args: unknown[]) => void;
type StubMessagePort = {
  close: () => void;
  on: (event: string, listener: StubListener) => unknown;
  postMessage: (message: unknown) => void;
  start: () => void;
};
type StubWebContents = {
  id: number;
  mainFrame: {
    url: string;
  };
  getURL: () => string;
  isDestroyed: () => boolean;
  off: (event: string, listener: StubListener) => unknown;
  on: (event: string, listener: StubListener) => unknown;
  once: (event: string, listener: StubListener) => unknown;
  removeListener: (event: string, listener: StubListener) => unknown;
  send: (channel: string, ...args: unknown[]) => void;
};
type IpcMainEvent = {
  returnValue: unknown;
  processId: number;
  frameId: number;
  sender: StubWebContents;
  senderFrame: {
    url: string;
  };
  ports: StubMessagePort[];
  reply: (channel: string, ...args: unknown[]) => void;
};

type IpcMainBridgeState = {
  sendToRenderer?: (
    webContentsId: number,
    message: {
      type: "ipc-main-event";
      channel: string;
      args: unknown[];
    },
  ) => void;
  handleRendererInvoke?: (
    channel: string,
    args: unknown[],
    windowId: number,
  ) => Promise<unknown>;
  handleRendererPostMessage?: (
    channel: string,
    message: unknown,
    ports: StubMessagePort[],
    windowId: number,
  ) => void;
  handleRendererSend?: (
    channel: string,
    args: unknown[],
    windowId: number,
  ) => void;
};

function getIpcMainBridgeState(): IpcMainBridgeState {
  const globals = globalThis as typeof globalThis & {
    __codexElectronIpcBridge?: IpcMainBridgeState;
  };
  if (!globals.__codexElectronIpcBridge) {
    globals.__codexElectronIpcBridge = {};
  }
  return globals.__codexElectronIpcBridge;
}

function createDeepStub(pathLabel: string): StubFunction {
  const fn: StubFunction = () => undefined;

  return new Proxy(fn, {
    construct(_target, _argArray) {
      return {};
    },
    get(_target, prop) {
      // Preserve native function helpers used by upstream Electron methods.
      if (prop === "bind" || prop === "call" || prop === "apply") {
        return Reflect.get(_target, prop);
      }

      if (prop === "then") {
        return undefined;
      }

      if (prop === Symbol.toPrimitive) {
        return () => pathLabel;
      }

      return createDeepStub(`${pathLabel}.${String(prop)}`);
    },
  });
}

function createEmitterStub(): {
  addListener: (event: string, listener: StubListener) => unknown;
  emit: (event: string, ...args: unknown[]) => boolean;
  off: (event: string, listener: StubListener) => unknown;
  on: (event: string, listener: StubListener) => unknown;
  once: (event: string, listener: StubListener) => unknown;
  removeListener: (event: string, listener: StubListener) => unknown;
} {
  const listeners = new Map<string, Set<StubListener>>();

  const api = {
    on(event: string, listener: StubListener): unknown {
      const eventListeners = listeners.get(event) ?? new Set<StubListener>();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
      return api;
    },
    once(event: string, listener: StubListener): unknown {
      const wrapped: StubListener = (...args: unknown[]) => {
        api.removeListener(event, wrapped);
        listener(...args);
      };
      return api.on(event, wrapped);
    },
    addListener(event: string, listener: StubListener): unknown {
      return api.on(event, listener);
    },
    removeListener(event: string, listener: StubListener): unknown {
      listeners.get(event)?.delete(listener);
      return api;
    },
    off(event: string, listener: StubListener): unknown {
      return api.removeListener(event, listener);
    },
    emit(event: string, ...args: unknown[]): boolean {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
      return true;
    },
  };

  return api;
}

function createMessagePortStub(): {
  on: (event: string, listener: StubListener) => unknown;
  postMessage: (...args: unknown[]) => void;
  start: () => void;
} {
  const emitter = createEmitterStub();
  return {
    on: emitter.on,
    postMessage(..._args: unknown[]): void {},
    start(): void {},
  };
}

function createIpcMainEvent(
  windowId: number,
  ports: StubMessagePort[] = [],
): IpcMainEvent {
  const window = BrowserWindow.fromId(windowId);
  if (!window || window.isDestroyed()) {
    throw new Error(
      `[electron-main-stub] Renderer window ${windowId} is closed`,
    );
  }
  const sender = window.webContents as unknown as StubWebContents;
  return {
    returnValue: undefined,
    processId: windowId,
    frameId: 1,
    sender,
    senderFrame: sender.mainFrame,
    ports,
    reply: (channel: string, ...args: unknown[]): void => {
      sender.send(channel, ...args);
    },
  };
}

function createIpcMainStub(): {
  handle: (
    channel: string,
    handler: (event: unknown, ...args: unknown[]) => unknown,
  ) => void;
  off: (event: string, listener: StubListener) => unknown;
  on: (event: string, listener: StubListener) => unknown;
  removeHandler: (channel: string) => void;
} {
  const emitter = createEmitterStub();
  const handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => unknown
  >();
  const bridgeState = getIpcMainBridgeState();

  const pendingPostMessages = new Map<
    string,
    Array<{ message: unknown; ports: StubMessagePort[]; windowId: number }>
  >();
  const registeredPostMessageChannels = new Set<string>();

  bridgeState.handleRendererPostMessage = (
    channel: string,
    message: unknown,
    ports: StubMessagePort[],
    windowId: number,
  ): void => {
    if (registeredPostMessageChannels.has(channel)) {
      emitter.emit(channel, createIpcMainEvent(windowId, ports), message);
      return;
    }
    const pending = pendingPostMessages.get(channel) ?? [];
    pending.push({ message, ports, windowId });
    pendingPostMessages.set(channel, pending);
  };

  bridgeState.handleRendererInvoke = async (
    channel: string,
    args: unknown[],
    windowId: number,
  ): Promise<unknown> => {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error(`[electron-main-stub] No ipcMain.handle for ${channel}`);
    }
    const event = createIpcMainEvent(windowId);
    return await Promise.resolve(handler(event, ...args));
  };

  bridgeState.handleRendererSend = (
    channel: string,
    args: unknown[],
    windowId: number,
  ): void => {
    const event = createIpcMainEvent(windowId);
    emitter.emit(channel, event, ...args);
  };

  return {
    on(channel: string, listener: StubListener): unknown {
      const result = emitter.on(channel, listener);
      registeredPostMessageChannels.add(channel);
      const pending = pendingPostMessages.get(channel);
      if (pending) {
        pendingPostMessages.delete(channel);
        for (const { message, ports, windowId } of pending) {
          if (!BrowserWindow.fromId(windowId)) continue;
          emitter.emit(channel, createIpcMainEvent(windowId, ports), message);
        }
      }
      return result;
    },
    off: emitter.off,
    handle(
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => unknown,
    ): void {
      handlers.set(channel, handler);
    },
    removeHandler(channel: string): void {
      handlers.delete(channel);
    },
  };
}

let appReady = false;
const commandLineSwitches = new Map<string, string>();

const appBase = {
  ...createEmitterStub(),
  name: "Codex",
  isPackaged: false,
  getName(): string {
    return "Codex";
  },
  getVersion(): string {
    return globalThis.__CODEX_SHIM_VALUES__.version;
  },
  getLocale(): string {
    return "en-US";
  },
  getSystemLocale(): string {
    return "en-US";
  },
  getPreferredSystemLanguages(): string[] {
    return ["en-US"];
  },
  getPath(_name: string): string {
    return process.cwd();
  },
  getAppMetrics(): unknown[] {
    return [];
  },
  getAppPath(): string {
    return process.cwd();
  },
  async getGPUInfo(_infoLevel: string): Promise<{ gpuDevice: unknown[] }> {
    return { gpuDevice: [] };
  },
  setName(_name: string): void {},
  setPath(_name: string, _value: string): void {},
  setAppUserModelId(_value: string): void {},
  requestSingleInstanceLock(): boolean {
    return true;
  },
  isReady(): boolean {
    return appReady;
  },
  whenReady(): Promise<void> {
    appReady = true;
    return Promise.resolve();
  },
  commandLine: {
    appendSwitch(name: string, value?: string): void {
      commandLineSwitches.set(name, value ?? "");
    },
    appendArgument(_value: string): void {},
    getSwitchValue(name: string): string {
      return commandLineSwitches.get(name) ?? "";
    },
    hasSwitch(name: string): boolean {
      return commandLineSwitches.has(name);
    },
    removeSwitch(name: string): void {
      commandLineSwitches.delete(name);
    },
  },
  on(_event: string, _listener: (...args: unknown[]) => void): unknown {
    return app;
  },
  once(_event: string, _listener: (...args: unknown[]) => void): unknown {
    return app;
  },
  quit(): void {},
  exit(_code?: number): void {},
};

const app = new Proxy(appBase as Record<string, unknown>, {
  get(target, prop) {
    if (prop in target) {
      return target[prop as keyof typeof target];
    }

    return createDeepStub(`app.${String(prop)}`);
  },
}) as typeof appBase;

class BrowserWindow {
  static isInputShapeSupported(): boolean {
    return false;
  }

  static isSystemBackdropSupported(): boolean {
    return false;
  }

  static fromId(id: number): BrowserWindow | null {
    return (
      BrowserWindow.getAllWindows().find((window) => window.id === id) ?? null
    );
  }

  static nextId = 1;
  static allWindows: BrowserWindow[] = [];
  static focusedWindow: BrowserWindow | null = null;
  id: number;
  private destroyed = false;
  private visible = true;
  private title = "Codex";
  private bounds = { x: 0, y: 0, width: 1280, height: 820 };
  webContents: Record<string, unknown>;
  private readonly emitter: ReturnType<typeof createEmitterStub>;

  constructor(...args: unknown[]) {
    this.visible = (args[0] as { show?: boolean } | undefined)?.show !== false;
    this.id = BrowserWindow.nextId++;
    this.emitter = createEmitterStub();

    const webContentsEmitter = createEmitterStub();
    this.webContents = new Proxy(
      {
        ...webContentsEmitter,
        id: this.id * 1000 + 1,
        mainFrame: {
          url: "",
        },
        getURL: (): string => {
          return String(
            (this.webContents.mainFrame as { url?: string } | undefined)?.url ??
              "",
          );
        },
        isDestroyed: (): boolean => this.destroyed,
        loadURL: async (url: string): Promise<void> => {
          (this.webContents.mainFrame as { url: string }).url = url;
        },
        loadFile: async (..._loadFileArgs: unknown[]): Promise<void> => {},
        openDevTools: (..._openDevToolsArgs: unknown[]): void => {},
        send: (...sendArgs: unknown[]): void => {
          if (sendArgs.length === 0 || typeof sendArgs[0] !== "string") {
            return;
          }
          const [channel, ...args] = sendArgs as [string, ...unknown[]];
          getIpcMainBridgeState().sendToRenderer?.(
            this.webContents.id as number,
            {
              type: "ipc-main-event",
              channel,
              args,
            },
          );
        },
      } as Record<string, unknown>,
      {
        get: (target, prop) => {
          // Async Electron APIs can return this proxy; it must not be thenable.
          if (prop === "then") {
            return undefined;
          }
          if (prop in target) {
            return target[prop as keyof typeof target];
          }
          return createDeepStub(
            `BrowserWindow#${this.id}.webContents.${String(prop)}`,
          );
        },
      },
    );

    const window = new Proxy(this, {
      get: (target, prop) => {
        if (prop === "then") {
          return undefined;
        }
        if (prop in target) {
          return target[prop as keyof typeof target];
        }
        return createDeepStub(`BrowserWindow#${target.id}.${String(prop)}`);
      },
    });
    BrowserWindow.allWindows.push(window);
    BrowserWindow.focusedWindow = window;
    return window;
  }

  static getAllWindows(): BrowserWindow[] {
    return BrowserWindow.allWindows.filter((window) => !window.destroyed);
  }

  static getFocusedWindow(): BrowserWindow | null {
    if (BrowserWindow.focusedWindow && !BrowserWindow.focusedWindow.destroyed) {
      return BrowserWindow.focusedWindow;
    }
    return BrowserWindow.getAllWindows()[0] ?? null;
  }

  static fromWebContents(
    webContents: { id?: unknown } | null | undefined,
  ): BrowserWindow | null {
    if (!webContents) {
      return null;
    }

    return (
      BrowserWindow.getAllWindows().find(
        (window) =>
          window.webContents === webContents ||
          window.webContents.id === webContents.id,
      ) ?? null
    );
  }

  on(event: string, listener: StubListener): unknown {
    return this.emitter.on(event, listener);
  }

  once(event: string, listener: StubListener): unknown {
    return this.emitter.once(event, listener);
  }

  off(event: string, listener: StubListener): unknown {
    return this.emitter.off(event, listener);
  }

  removeListener(event: string, listener: StubListener): unknown {
    return this.emitter.removeListener(event, listener);
  }

  async loadURL(url: string): Promise<void> {
    (this.webContents.mainFrame as { url: string }).url = url;
  }

  close(): void {
    this.emitter.emit("close", {
      preventDefault: () => undefined,
    });
    this.destroy();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    (this.webContents.emit as StubFunction)("destroyed");
    BrowserWindow.allWindows = BrowserWindow.allWindows.filter(
      (window) => window !== this,
    );
    if (BrowserWindow.focusedWindow === this) {
      BrowserWindow.focusedWindow = null;
    }
    this.emitter.emit("closed");
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isFocused(): boolean {
    return BrowserWindow.focusedWindow === this && !this.destroyed;
  }

  isVisible(): boolean {
    return this.visible && !this.destroyed;
  }

  removeMenu(): void {}

  getTitle(): string {
    return this.title;
  }

  setTitle(nextTitle: string): void {
    this.title = nextTitle;
  }

  getBounds(): { height: number; width: number; x: number; y: number } {
    return { ...this.bounds };
  }

  setBounds(nextBounds: {
    height?: number;
    width?: number;
    x?: number;
    y?: number;
  }): void {
    this.bounds = {
      x: nextBounds.x ?? this.bounds.x,
      y: nextBounds.y ?? this.bounds.y,
      width: nextBounds.width ?? this.bounds.width,
      height: nextBounds.height ?? this.bounds.height,
    };
  }

  show(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  focus(): void {
    BrowserWindow.focusedWindow = this;
    this.emitter.emit("focus");
  }
}

class WebContentsView {
  constructor(..._args: unknown[]) {}
}

class Menu {
  static applicationMenu: Menu | null = null;
  items: MenuItem[] = [];

  constructor(items: MenuItem[] = []) {
    this.items = items;
  }

  static buildFromTemplate(template: unknown[]): Menu {
    const items = template.map((entry) => new MenuItem(entry));
    return new Menu(items);
  }

  static setApplicationMenu(menu: Menu | null): void {
    Menu.applicationMenu = menu;
  }

  static getApplicationMenu(): Menu | null {
    return Menu.applicationMenu;
  }

  getMenuItemById(id: string): MenuItem | undefined {
    const queue = [...this.items];
    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate) {
        continue;
      }
      if (candidate.id === id) {
        return candidate;
      }
      if (candidate.submenu) {
        queue.push(...candidate.submenu.items);
      }
    }
    return undefined;
  }

  append(item: MenuItem): void {
    this.items.push(item);
  }

  insert(pos: number, item: MenuItem): void {
    const index = Math.max(0, Math.min(pos, this.items.length));
    this.items.splice(index, 0, item);
  }

  popup(..._args: unknown[]): void {}
}

class MenuItem {
  checked?: boolean;
  click?: (...args: unknown[]) => unknown;
  enabled?: boolean;
  id?: string;
  label?: string;
  role?: string;
  submenu?: Menu;
  type?: string;
  visible?: boolean;

  constructor(...args: unknown[]) {
    const [options] = args as [Record<string, unknown>?];
    if (!options || typeof options !== "object") {
      return;
    }
    this.checked =
      typeof options.checked === "boolean" ? options.checked : undefined;
    this.click =
      typeof options.click === "function"
        ? (options.click as (...args: unknown[]) => unknown)
        : undefined;
    this.enabled =
      typeof options.enabled === "boolean" ? options.enabled : undefined;
    this.id = typeof options.id === "string" ? options.id : undefined;
    this.label = typeof options.label === "string" ? options.label : undefined;
    this.role = typeof options.role === "string" ? options.role : undefined;
    this.type = typeof options.type === "string" ? options.type : undefined;
    this.visible =
      typeof options.visible === "boolean" ? options.visible : undefined;

    const submenu = options.submenu;
    if (Array.isArray(submenu)) {
      this.submenu = Menu.buildFromTemplate(submenu);
      return;
    }
    if (submenu instanceof Menu) {
      this.submenu = submenu;
    }
  }
}

class Tray {
  constructor(..._args: unknown[]) {}
}

class Notification {
  constructor(..._args: unknown[]) {}

  show(): void {}
}

const dialog = {
  async showMessageBox(..._args: unknown[]): Promise<{ response: number }> {
    return { response: 0 };
  },
};

const crashReporter = {
  start(..._args: unknown[]): void {},
};

const net = {
  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input, init);
  },
  request(..._args: unknown[]): {
    getHeader: (name: string) => string | undefined;
    once: (event: string, listener: StubListener) => unknown;
    setHeader: (name: string, value: string) => void;
  } {
    const headers = new Map<string, string>();
    const request = {
      setHeader(name: string, value: string): void {
        headers.set(name.toLowerCase(), value);
      },
      getHeader(name: string): string | undefined {
        return headers.get(name.toLowerCase());
      },
      once(_event: string, _listener: StubListener): unknown {
        return request;
      },
    };
    return request;
  },
};

const autoUpdater = createEmitterStub();
const ipcMain = createIpcMainStub();
const nativeTheme = {
  ...createEmitterStub(),
  shouldUseDarkColors: false,
  shouldUseHighContrastColors: false,
  shouldUseInvertedColorScheme: false,
  themeSource: "system",
};
const nativeImage = {
  createEmpty(): { isEmpty: () => boolean } {
    return {
      isEmpty: () => true,
    };
  },
  createFromPath(imagePath: string): { isEmpty: () => boolean } {
    return {
      isEmpty: () => !imagePath,
    };
  },
};
const powerMonitor = {
  ...createEmitterStub(),
  getSystemIdleState(_idleThreshold: number): string {
    return "unknown";
  },
  getSystemIdleTime(): number {
    return 0;
  },
  isOnBatteryPower(): boolean {
    return false;
  },
};
// Desktop shortcuts and sleep inhibitors have no native window in the web host.
const globalShortcut = {
  register(..._args: unknown[]): boolean {
    return false;
  },
  isRegistered(_accelerator: string): boolean {
    return false;
  },
  unregister(..._args: unknown[]): void {},
  unregisterAll(): void {},
};
const powerSaveBlocker = {
  start(_type: string): number {
    return 0;
  },
  stop(_id: number): void {},
  isStarted(_id: number): boolean {
    return false;
  },
};
const screen = {
  ...createEmitterStub(),
  getAllDisplays() {
    return [this.getPrimaryDisplay()];
  },
  getDisplayMatching() {
    return this.getPrimaryDisplay();
  },
  getPrimaryDisplay() {
    return {
      id: 1,
      scaleFactor: 1,
      size: { width: 1280, height: 820 },
      workArea: { x: 0, y: 0, width: 1280, height: 820 },
      workAreaSize: { width: 1280, height: 820 },
      bounds: { x: 0, y: 0, width: 1280, height: 820 },
    };
  },
};

const protocol = {
  registerSchemesAsPrivileged(..._args: unknown[]): void {},
  handle(..._args: unknown[]): void {},
  registerStringProtocol(..._args: unknown[]): void {},
};
function createSessionStub() {
  const emitter = createEmitterStub();
  return {
    ...emitter,
    cookies: {
      ...createEmitterStub(),
      get: async (..._args: unknown[]) => [] as unknown[],
      remove: async (..._args: unknown[]) => {},
      set: async (..._args: unknown[]) => {},
    },
    getDownloadHistory: async () => [] as unknown[],
    loadExtension: async (extensionPath: string) => ({
      id: "unsupported",
      name: "Unsupported",
      path: extensionPath,
      version: "0.0.0",
    }),
    getUserAgent: () =>
      "Mozilla/5.0 AppleWebKit/537.36 Chrome/120 Safari/537.36",
    protocol,
    setPermissionCheckHandler: (..._args: unknown[]) => {},
    setPermissionRequestHandler: (..._args: unknown[]) => {},
    setPreferredLanguages: (_languages: string[]) => {},
    webRequest: {
      onBeforeRequest: (..._args: unknown[]) => {},
      onBeforeSendHeaders: (..._args: unknown[]) => {},
    },
  };
}

const partitionSessions = new Map<
  string,
  ReturnType<typeof createSessionStub>
>();
const session = {
  defaultSession: createSessionStub(),
  fromPartition(partition: string): ReturnType<typeof createSessionStub> {
    let partitionSession = partitionSessions.get(partition);
    if (!partitionSession) {
      partitionSession = createSessionStub();
      partitionSessions.set(partition, partitionSession);
    }
    return partitionSession;
  },
};
const utilityProcess = {
  fork: undefined,
};
const webContents = {
  fromId(id: number): Record<string, unknown> | undefined {
    return BrowserWindow.getAllWindows().find(
      (window) => window.webContents.id === id,
    )?.webContents;
  },
  getAllWebContents(): Record<string, unknown>[] {
    return BrowserWindow.getAllWindows().map((window) => window.webContents);
  },
  getFocusedWebContents(): Record<string, unknown> | null {
    return BrowserWindow.getFocusedWindow()?.webContents ?? null;
  },
};
class MessageChannelMain {
  port1 = createMessagePortStub();
  port2 = createMessagePortStub();
}

const electronModule = new Proxy(
  {
    app,
    BrowserWindow,
    ipcMain,
    autoUpdater,
    crashReporter,
    MessageChannelMain,
    Menu,
    MenuItem,
    net,
    nativeImage,
    nativeTheme,
    Notification,
    powerMonitor,
    powerSaveBlocker,
    globalShortcut,
    protocol,
    screen,
    session,
    Tray,
    utilityProcess,
    WebContentsView,
    webContents,
    dialog,
  } as Record<string, unknown>,
  {
    get(target, prop) {
      if (prop in target) {
        return target[prop as keyof typeof target];
      }

      return createDeepStub(`electron.${String(prop)}`);
    },
  },
);

export {
  app,
  autoUpdater,
  BrowserWindow,
  ipcMain,
  Menu,
  MenuItem,
  MessageChannelMain,
  net,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  globalShortcut,
  protocol,
  screen,
  session,
  Tray,
  utilityProcess,
  WebContentsView,
  webContents,
  crashReporter,
  dialog,
};
export default electronModule;
