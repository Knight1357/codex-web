# codex-web

a browser frontend for codex desktop, running on a machine you control.

https://github.com/user-attachments/assets/0a33cbd8-741c-412c-9e75-46dfe9324596

## motivation

the agents were never meant to stay trapped in a terminal window for long.
codex desktop brought the power of agents to your local computer, where your
files, credentials, and tools already live.

codex-web brings codex desktop to the browser while keeping the backend on a
machine you control (a linux box in the cloud, your home lab, or a desktop / mac
mini). agents keep running after your laptop closes. you can reconnect from any
device with a browser.

this project aims to be as thin a wrapper as possible to ensure upstream changes
to the codex desktop app can be integrated quickly.

## usage

`codex-web` serves the browser client and hosts the desktop-side bridge. by
default, it listens on `127.0.0.1:8214`.

it will use `codex` from `PATH` if available, or `CODEX_CLI_PATH` if you set
it.

run it with `npx`:

```bash
npx --yes github:0xcaff/codex-web
```

or with nix:

```bash
nix run github:0xcaff/codex-web
```

then open <http://127.0.0.1:8214> in a browser.

### Codex Only Mode

Set the server environment flag to make the browser client use only Codex:

```bash
CODEX_ONLY_MODE=true npm run server
```

For a server that needs the host's configured HTTP proxy (Node with environment proxy support):

```bash
CODEX_ONLY_MODE=true NODE_USE_ENV_PROXY=1 npm run server
```

The flag defaults to `false`. To restore the upstream UI, restart with
`CODEX_ONLY_MODE=false`. Changing this runtime flag does not require rebuilding.
A `.env` file is not loaded automatically; export the variable in your shell or
pass `--env-file` to Node if you use one.

In this mode `/` redirects to `/codex`, which maps to the upstream Codex agent
home. Browser thread URLs stay `/thread/<id>`; project/settings links and review
queries survive refresh and browser Back/Forward. Non-Codex product navigation,
Quick Chat, product-switch commands, ChatGPT conversations in the sidebar and
mention picker, unrelated settings, and empty file/site creation shortcuts are
hidden. Codex projects, local/cloud Codex threads, file outputs, model/reasoning
controls, review, approvals, sandbox controls, plugins, and account/authentication
remain available. Codex Voice remains available with Codex labels.

The flag is published as a boolean by `/__backend/ui-config.js` before the
renderer starts. UI policy lives in `src/browser/codex-only.ts`; one additive
`patches/webview-codex-only.patch` applies last in `scripts/prepare_asar`. UI message
literals are branded before interpolation; user content and model responses are
not rewritten. Stored product/detail preferences, OAuth URLs, tokens, account
capabilities and the CLI/app-server protocol are not changed. This is a UI mode,
not an authentication or security boundary.

Verify policy and compatibility with:

```bash
npm run test:codex-only
npm run build:browser
npm run build:server
```

After updating the downloaded desktop app, bundle hashes and patch context may
change. Rebase the additive patch after the existing upstream patches and check
history setup, product/home selectors, sidebar/source filters, internationalized
labels, settings navigation, and the thread output shortcuts. The internal home
composer name `work` is shared by the Codex agent; the visible product is forced
to `codex` without removing that shared component.

### sign in

ensure the codex cli on the host machine is signed in before starting the
server.

```bash
codex login --device-auth
```

### proxying to app-server (advanced usage)

it’s often useful to run the app server separately, so a crash or restart of
codex-web doesn’t interrupt the codex process executing commands.

it's possible to hook codex-web up to an already-running app server using the
`codex_remote_proxy` script.

start a long-lived app server somewhere:

```bash
mkdir -p /tmp/codex-app-server
cd /tmp/codex-app-server
codex app-server --listen unix://codex-app-server.sock
```

then run `codex-web` with the proxy helper:

```bash
nix shell github:0xcaff/codex-web github:0xcaff/codex-web#codex_remote_proxy -c bash -lc '
  export CODEX_UNIX_SOCKET=/tmp/codex-app-server/codex-app-server.sock
  export CODEX_CLI_PATH="$(command -v codex_remote_proxy)"
  codex-web
'
```

`codex app-server proxy --sock ...` is a raw stdio protocol bridge for another
program to use; when run directly in a terminal it will wait for protocol input
rather than opening an interactive prompt.

## security

run `codex-web` only on trusted networks. treat anyone who can reach the
`codex-web` server as someone who can operate codex on the host machine as the
same user running the server.

if you need authn or authz, implement it outside of `codex-web`: proxy it through
wireguard, tailscale, or an ssh tunnel and put an authentication gateway or
reverse proxy in front.

someone with access to the web ui may be able to:

- run commands on the host, limited only by the permissions of the `codex-web`
  server process.
- read or modify files, environment variables, credentials, ssh keys, and other
  local resources that are accessible to that process.
- use the codex / chatgpt account already signed in on the host. this may
  consume usage quota or billing credits, and may expose account metadata shown
  by the app or cli, such as name or email address.

## features

- hostable on macOS, Linux (and anything codex cli + node will run on)
- reachable from the browser
- thin wrapper, so updates should land fast
- working today:
  - subagents
  - inline images
  - editor sidepanel
  - transcription

## roadmap

some parts of the desktop experience are not wired up yet:

- browser panel support, likely rebuilt around iframes
- computer use on linux, which could become a very powerful feature
- terminal support
- git worker integration
- whatever else people find and file issues for

## issues welcome

if something is broken, missing, or rough around the edges, please file an
issue.

using `codex-web` in an interesting way? post about it on x and tag me
[@0xcaff](https://x.com/0xcaff).

using this at a company and need something more tailored? email me and we can
talk.

## alternatives

* [davej/pocodex](https://github.com/davej/pocodex) i used this until the wheels fell off. i needed subagents
  and an inline image viewer. this didn't have them and was having a hard time
  keeping up with upstream codex updates.
* the native codex remote feature (behind a feature flag) is great for
  connecting to remote codex hosts over ssh to manage long running tasks but
  this only works if you have codex desktop on your client device. this means it
  doesn't work on mobile.
* upcoming first party mobile app from openai. `codex-web` exists and works
  today. i can't wait for the mobile app but judging by the other openai mobile
  apps, i'm a little bit skeptical about the quality of the mobile experience.
  time will tell.
