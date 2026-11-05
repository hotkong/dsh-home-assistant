# dsh-home-assistant

English | [中文](./README.md)

> Configure your Home Assistant instance once — **every new session then starts already knowing where it is, what version it runs and how it is doing**. No more re-reading docs or copying tokens between sessions.

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin: open **Settings → Home Assistant**, fill in the URL, token and 1–6 values you care about, and it injects a compact environment block into the system prompt, exposes a read-only `ha_status` tool, and renders a live status card.

```text
<home_assistant label="Living room HA" url="http://homeassistant.local:8123">
Core 2026.10.4 ｜ Supervisor 2026.10.4 ｜ OS 18.3.1
状态：RUNNING（recovery_mode=false，watchdog=true）
规模：42 实体 / 7 设备 / 3 区域 / 5 集成
磁盘：已用 13.8/27.7 GB
统计：亮灯数 3 ｜ 室内温度 22.0 °C ｜ 在家 1
更新：2026-11-04 18:14 (+08:00)
</home_assistant>
```

The block rides along on **every request** (~150–300 tokens), so the first question of a session gets a precise answer. Config lives in the profile, so every workspace shares it.

## Install

```sh
dsh plugin --profile web add dsh-home-assistant
```

Reload the page afterwards (or restart `dsh web`).

For local development, `link:` the repository into the profile's `dependencies` and add its package name to `dsh.profile.bundles`; the bundle's own `cordis.patch.yml` inserts the `home-assistant` row, so the profile patch only needs to override `config`. That is how this checkout runs (see the verification log in `openspec/changes/0001-dsh-ha-plugin/tasks.md`).

## Using it

Four entry points:

1. **Left main panel (full overview)** — **Home Assistant** in the left navigation. It opens a read-only overview: versions, core state, scale, disk, time zone, all stats, update time, refresh/open HA; the configuration entry is noted in the page.
2. **Right sidebar (compact card)** — add **Home Assistant** from the right sidebar's **+ / guide**. The panel shows the status dot, Core/Supervisor versions, core state, entity scale, up to three stats and the update time. It refreshes every 30 s (paused while hidden); **Refresh** forces a probe and **Open** jumps to the instance.
3. **Configure (Settings)** — open **Settings → Home Assistant**. The full status card sits on top, and the form below edits the instance URL, display name, notes, the **access token** (saved into the credential store), up to six stats, prompt injection, the workspace allowlist, and scale counting. **Save** / **Save token** apply immediately; no restart.
4. **Ask the agent** — "how is Home Assistant doing?" triggers `ha_status`; and since the environment block rides on every prompt, questions like "how many lights are on?" just work.

> The settings page registers on `settings.section`; the left main panel registers on `sidebar.panellist` + `main` (the same mechanism as `dsh-github-flow`); the right sidebar registers on the official `sidebarRightTabs` + `sidebar.right.pane.tab` (the same mechanism as `dsh-github-workbench`). A host without a service silently skips that entry; the other entries and `ha_status` keep working. Without `configForms` the form degrades to a read-only notice.

## Access token

**UI (recommended)**: Settings → Home Assistant → paste the long-lived token under **Access token** → **Save token**. It goes through the host credential service into `HA_TOKEN` in `$DSH_HOME/.credentials.yaml` — never into the profile config, logs, or a market backup. **Clear** removes it. The page shows the current resolution (`credential:HA_TOKEN` or `no token found`).

**Manual/advanced (optional)**: you can maintain the credential file yourself (mode `0600`):

```yaml
version: 1
refs:
  HA_TOKEN: <long-lived access token>
```

The plugin reads `HA_TOKEN` by default. `tokenRef` is only for this advanced path — the UI does not expose it. Renaming it to `FOO` also requires a `FOO: <token>` entry under `refs`, otherwise the plugin falls back to an environment variable of that name.

**Fallback (not recommended)**: an inline `token` in the profile YAML is stored **in plain text** in `cordis.patch.yml` and carried by the market's "include config files" backup.

Create the token in Home Assistant under *Profile → Security → Long-lived access tokens*. For read-only use, prefer a **non-admin** user's token: state reads don't need admin, and a few counters (devices/areas/integrations) simply degrade to empty.

## Settings

| Field | Meaning |
|---|---|
| `baseUrl` | Instance URL with port, e.g. `http://homeassistant.local:8123` |
| `label` | Display name used by the prompt block and the card |
| `notes` | Free-form note (e.g. "restart takes ~5 min"), copied into the injection block only; no effect while injection is off |
| `stats` | 1–6 entries, see below |
| `tokenRef` / `token` | Advanced: profile YAML only. The UI writes `HA_TOKEN` through the credential service; `tokenRef` is a key, not the token |
| `inject.enabled` / `refreshSec` / `maxChars` | Global injection switch, refresh interval, character cap (default 600) |
| `inject.workspaces` | Workspace allowlist: inject only under these absolute paths (subdirectories included); empty = every workspace. `ha_status` is unaffected |
| `status.*` | Cache TTL, request timeout, whether to count the scale |

### Stats

Each entry is either an entity shortcut (no admin needed) or a Jinja template (admin required, allows aggregates):

```yaml
stats:
  - title: Living room
    entity: sensor.living_room_temperature
    unit: " °C"
  - title: Lights on
    template: "{{ states.light | selectattr('state','eq','on') | list | count }}"
```

Optional `attribute` reads one attribute. A failing entry renders `—` without affecting the others. Templates **come from configuration only** — tool arguments never accept one, because HA's template endpoint can read the whole house.

## Scope

**Does**: connection probe (versions / core state / recovery / watchdog / disk / scale), stats, system-prompt injection, Settings card, `ha_status`.

**Does not** (by design): device control (use HA's UI or the official MCP Server), config edits / restart / logs / automation editing / backups / YAML files (use HA's UI or [ha-mcp](https://github.com/homeassistant-ai/ha-mcp)), multiple instances.

## Security

- Probes are **read-only**; the plugin never mutates Home Assistant.
- Tokens are masked in logs, prompt blocks, the card, and the browser.
- Prompt assembly reads the cache only — an unreachable HA never blocks a conversation.
- Keep the credential file at `0600`; see the inline-token caveat above.

## Troubleshooting

| Symptom | Check first |
|---|---|
| No "Home Assistant" in Settings | `dsh --profile web --dump-config \| grep home-assistant`; no row = the package is not in `dsh.profile.bundles` (being in `node_modules` is not enough) |
| Page exists but the form says "no configuration namespace" | `Config` failed to load: `@deepseek-ai/schemastery` is unresolvable. A `link:`-ed package resolves from its real path, so give it its own `node_modules` link |
| Save is rejected / does nothing | Every edited field must sit under a `volatile()` ancestor; inspect the `settings/mutate` response in the browser network tab |
| First prompt after a restart says "no token" | Credentials-service startup race; "no credential" failures use a 5 s TTL, so it self-heals |
| Status stays unreachable | `curl '<baseUrl>/api/' -H "Authorization: Bearer $HA_TOKEN"`, then `GET /dsh-home-assistant/status?refresh=1` |

## Development

```sh
# Against a real instance: print the model-facing text + prompt block, assert ≤ 4 KB
HA_TOKEN=... node test/run.mjs http://homeassistant.local:8123

# Offline: injection switch + workspace allowlist
node test/prompt.mjs

# Offline: mount the browser half, assert the settings.section registration renders
node test/client.mjs
```

`test/run.mjs` mounts the server half against a fake cordis context; `test/prompt.mjs` covers the injection switch and workspace allowlist; `test/client.mjs` mounts the client half against a fake `__ModuleLoader__` plus a minimal React stand-in, and statically checks that every `ctx.*` access is declared in `inject`; no browser required.

> **Local `link:` gotcha**: Node resolves a symlinked package to its real path before walking up for `node_modules`. A `link:`-ed plugin therefore needs its own view of `@deepseek-ai/schemastery` — either install it normally into the profile (so pnpm's store provides it) or add a `node_modules/@deepseek-ai/schemastery` link inside the plugin directory. Otherwise `Config` is `undefined`, the settings form disappears, and tools/injection keep working.

## License

MIT
