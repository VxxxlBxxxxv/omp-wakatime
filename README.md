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

## Install from GitHub

```bash
git clone https://github.com/VxxxlBxxxxv/omp-wakatime.git
cd omp-wakatime
npm install
npm run build
omp install .
```

For a one-session smoke test without installing:

```bash
omp -e ./dist/index.js
```

After an npm release exists, the package-name form should be:

```bash
omp install omp-wakatime
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

## Heartbeat batching (design decision)

The official plugin guide targets interactive editors: send a heartbeat when enough time passed, the focused file changed, or a file was saved. An agent runtime produces hundreds of tool events per session, so this extension deliberately batches instead:

- file activity accumulates in a pending map and flushes at most once per 60 seconds per project;
- save events are merged into the batch (they set `--write` but do not bypass the interval), so a write heartbeat can lag its actual timestamp by up to 60 seconds;
- session shutdown force-flushes everything pending.

wakatime-cli deduplicates on its side, so total tracked time is unaffected; only per-heartbeat timestamps are coarser.

## Troubleshooting

- **No time shows up in WakaTime.** Check the API key: `~/.wakatime.cfg` must contain `[settings]` / `api_key = ...` (key from https://wakatime.com/api-key), or set `WAKATIME_API_KEY`. A missing key is reported once at startup in the extension log.
- **Extension log:** `~/.wakatime/omp-wakatime.log` (respects `$WAKATIME_HOME`). wakatime-cli writes its own log to `~/.wakatime/wakatime.log`.
- **Debug mode:** set `debug = true` in `~/.wakatime.cfg` or export `OMP_WAKATIME_DEBUG=1`. This also passes `--verbose` to wakatime-cli.
- **Old global wakatime-cli.** If a `wakatime-cli` on `PATH` lacks the AI heartbeat flags (`--sync-ai-disabled`, `--ai-line-changes`), the extension ignores it and uses its bundled CLI; look for "Global wakatime-cli is too old" in the log.
- **Verify ingestion:** your activity should appear as editor "Omp" on the WakaTime dashboard, or query the [User Agents API](https://wakatime.com/developers#user_agents).

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
