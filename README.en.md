# dsh-home-assistant

English | [中文](./README.md)

> Configure your Home Assistant instance once — **every new session then starts already knowing where it is, what version it runs and how it is doing**. No more re-reading docs or copying tokens between sessions.

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin: point it at an instance, define 1–6 values you care about, and it injects a compact environment block into the system prompt, exposes a read-only `ha_status` tool, and renders a status card in Settings.

```text
<home_assistant label="Living room HA" url="http://192.168.0.11:8123">
Core 2026.10.4 ｜ Supervisor 2026.10.4 ｜ OS 18.3.1
状态：RUNNING（recovery_mode=false，watchdog=true）
规模：3965 实体 / 497 设备 / 36 区域 / 74 集成
磁盘：已用 13.8/27.7 GB
统计：亮灯数 37 ｜ 室内温度 22.0 °C ｜ 在家 1
更新：2026-11-04 16:34 (+08:00)
</home_assistant>
```

The block rides along on **every request** (~150–300 tokens), so the first question of a session gets a precise answer. Config lives in the profile, so every workspace shares it.

## Install

```sh
dsh plugin --profile web add dsh-home-assistant
```

Reload the page afterwards (or restart `dsh web`).

## Token (pick one)

**Recommended — credential reference** (never lands in the profile config or a market backup). Add to `$DSH_HOME/.credentials.yaml` (mode must be `0600`):

```yaml
version: 1
refs:
  HA_TOKEN: <long-lived access token>
```

The plugin reads `HA_TOKEN` by default; change `tokenRef` to use another name. A plain `HA_TOKEN` environment variable works too.

**Fallback — inline `token`** in Settings. Write-only, but stored **in plain text** in the profile's `cordis.patch.yml` and carried by the market's "include config files" backup. Use it only to try the plugin out.

Create the token in Home Assistant under *Profile → Security → Long-lived access tokens*. For read-only use, prefer a **non-admin** user's token: state reads don't need admin, and a few counters (devices/areas/integrations) simply degrade to empty.

## Settings

| Field | Meaning |
|---|---|
| `baseUrl` | Instance URL with port, e.g. `http://192.168.0.11:8123` |
| `label` | Display name used by the prompt block and the card |
| `notes` | Free-form note (e.g. "restart takes ~5 min"), copied into the block |
| `stats` | 1–6 entries, see below |
| `tokenRef` / `token` | Token source |
| `inject.*` | Whether to inject, refresh interval, character cap (default 600) |
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

## Development

```sh
HA_TOKEN=... node test/run.mjs http://192.168.0.11:8123
```

The harness mounts the plugin against a fake cordis context, prints what the model would see, and asserts the tool result stays under 4 KB.

## License

MIT
