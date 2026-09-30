/** Runtime presentation flag; no changes to CLI or account configuration. */
export function readUiConfig(
  env: Record<string, string | undefined> = process.env,
) {
  return {
    codexOnlyMode: env.CODEX_ONLY_MODE?.trim().toLowerCase() === "true",
  };
}

export function uiConfigScript(
  config: ReturnType<typeof readUiConfig>,
): string {
  return `window.__CODEX_WEB_CONFIG__ = Object.freeze(${JSON.stringify(config)});`;
}
