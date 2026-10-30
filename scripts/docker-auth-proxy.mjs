// The CLI binds its OAuth callback to container loopback. Publish a separate
// listener through Docker so the host browser can reach that callback unchanged.
import net from "node:net";
import { isMainThread } from "node:worker_threads";

// Node workers inherit --import. Only the server's main thread owns the relay.
if (isMainThread) {
  const proxy = net.createServer({ allowHalfOpen: true }, (browser) => {
    const callback = net.connect({ host: "127.0.0.1", port: 1455 });
    browser.on("error", () => callback.destroy());
    callback.on("error", () => browser.destroy());
    browser.on("close", () => callback.destroy());
    browser.pipe(callback).pipe(browser);
  });

  proxy.listen(1456, "0.0.0.0");
}
