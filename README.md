# omp-wakatime

WakaTime activity tracking extension for [Oh My Pi](https://omp.sh) / `@oh-my-pi/pi-coding-agent`.

`omp-wakatime` tracks OMP session activity and file operations through `wakatime-cli`, including WakaTime AI coding metrics for edits.

## Features

- OMP-native extension via `omp.extensions`.
- Tracks `session_start`, `tool_result`, and `session_shutdown`.
- Sends synthetic session activity as `<project>/.omp-session`.
- Tracks file activity for `read`, `write`, `edit`, and `ast_edit`.
- Reports AI line changes with `--ai-line-changes` for write/edit/ast_edit.
- Uses `wakatime-cli`, `~/.wakatime.cfg`, and `$WAKATIME_HOME` conventions.
- Finds global `wakatime-cli`; otherwise downloads a local CLI into WakaTime resources.
- Rate-limits normal heartbeats to 1/min/project and force-flushes on shutdown.
- Fails open: WakaTime errors never break OMP tool calls.
- Adds `--sync-ai-disabled`; prompt and tool output are never sent as heartbeat data.

## Install

```bash
omp install omp-wakatime
```

For local development:

```bash
git clone https://github.com/VxxxlBxxxxv/omp-wakatime.git
cd omp-wakatime
npm install
npm run build
omp -e ./dist/index.js
```

## Configure WakaTime

Create `~/.wakatime.cfg`:

```ini
[settings]
api_key = waka_your_api_key_here
```

Optional debug logging:

```ini
[settings]
debug = true
```

Logs are written to:

```text
~/.wakatime/omp-wakatime.log
```

State is written to:

```text
~/.wakatime/omp-wakatime-state/
~/.wakatime/omp-wakatime-cli-state.json
```

If `$WAKATIME_HOME` is set, resources live under that directory and config is read from `$WAKATIME_HOME/.wakatime.cfg`.

## What is sent to WakaTime

Session heartbeat:

```bash
wakatime-cli \
  --entity <project>/.omp-session \
  --entity-type file \
  --project-folder <project> \
  --plugin "oh-my-pi/<version> omp-wakatime/<version>" \
  --sync-ai-disabled \
  --is-unsaved-entity \
  --category coding
```

File heartbeat:

```bash
wakatime-cli \
  --entity <absolute-file-path> \
  --entity-type file \
  --project-folder <project> \
  --plugin "oh-my-pi/<version> omp-wakatime/<version>" \
  --sync-ai-disabled \
  --category "ai coding" \
  --write \
  --ai-line-changes <net-lines>
```

## Privacy boundary

Sent intentionally:

- project folder;
- file path/entity;
- category;
- plugin identifier;
- AI line-change count.

Not sent by this extension:

- prompt text;
- tool output;
- command output;
- file content;
- browser/page content.

WakaTime is a metadata SaaS. If project/file path metadata is sensitive, use a self-hosted WakaTime-compatible backend such as Wakapi or do not enable this extension.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

## Credits

Architecture references:

- [`@chronova/pi-plugin`](https://github.com/nx-solutions-ug/chronova-pi-plugin) — OMP-native heartbeat scaffold.
- [`pi-wakatime`](https://github.com/ttttmr/pi-wakatime) — Pi WakaTime heartbeat semantics.
- [`opencode-wakatime`](https://github.com/angristan/opencode-wakatime) — WakaTime CLI management and AI coding metrics patterns.

## Contract

IWE IntegrationGate references: `DP.SC.182` and `DP.ROLE.071`.

## License

MIT
