/**
 * dsh-home-assistant — configure a Home Assistant instance once, and let every
 * session start already knowing where it is, what version it runs and how it is
 * doing.
 *
 * Server half: config + probe cache + system-prompt section + one read-only tool
 * + a small status route the settings card reads.
 */

import Schema from '@deepseek-ai/schemastery'
import { Probe } from './probe.js'
import { renderBlock } from './prompt.js'
import { val, localTime, oneLine } from './util.js'

export const name = 'home-assistant'
export const inject = ['tools']

/** Section order: after the tool instructions, before the trailing tail sections. */
const SECTION_ORDER = 900

export const Config = Schema.object({
    baseUrl: Schema.string()
      .default('http://homeassistant.local:8123')
      .description('Home Assistant 地址（含端口，例如 http://192.168.0.11:8123）')
      .volatile(),
    tokenRef: Schema.string()
      .default('HA_TOKEN')
      .description('凭据引用名：从 $DSH_HOME/.credentials.yaml 或环境变量解析（推荐）')
      .volatile(),
    token: Schema.string()
      .role('secret')
      .default('')
      .description('内联长期访问令牌，仅作兜底；会明文写入 profile 配置与市场备份')
      .volatile(),
    label: Schema.string().default('').description('显示名，例如「客厅 HA」'),
    notes: Schema.string().default('').description('自由备注（如「重启约 5 分钟」），会原样进入注入块'),
    stats: Schema.array(
      Schema.object({
        title: Schema.string().required().description('显示标题，例如「客厅温度」'),
        entity: Schema.string().default('').description('实体 ID（与 template 二选一）'),
        attribute: Schema.string().default('').description('可选：读取实体的某个属性'),
        template: Schema.string().default('').description('Jinja 模板（需要管理员令牌；与 entity 二选一）'),
        unit: Schema.string().default('').description('单位后缀，例如 °C'),
      }),
    )
      .default([])
      .description('1–6 个观测项，渲染进注入块与状态卡'),
    inject: Schema.object({
      enabled: Schema.boolean().default(true).description('把环境块注入系统提示词'),
      refreshSec: Schema.number().default(60).description('注入用快照的刷新间隔（秒）'),
      maxChars: Schema.number().default(600).description('注入块字数上限'),
    }).default({}),
    status: Schema.object({
      refreshSec: Schema.number().default(30).description('状态缓存 TTL（秒）'),
      timeoutMs: Schema.number().default(5000).description('单次请求超时（毫秒）'),
      showScale: Schema.boolean().default(true).description('统计实体/设备/区域/集成数量（会多发 1–4 个请求）'),
    }).default({}),
})

/** Public snapshot for the card and the tool — strips internals, keeps it small. */
function publicSnapshot(snapshot) {
  if (!snapshot) return { ok: false, pending: true, hints: ['正在首次探测 Home Assistant…'], updated_at: null }
  return {
    ok: snapshot.ok,
    label: snapshot.label,
    url: snapshot.url,
    version: snapshot.version,
    core_state: snapshot.core_state,
    recovery_mode: snapshot.recovery_mode,
    watchdog: snapshot.watchdog,
    disk: snapshot.disk,
    scale: snapshot.scale,
    stats: snapshot.stats,
    time_zone: snapshot.time_zone,
    hints: snapshot.hints,
    updated_at: localTime(new Date(snapshot.at), snapshot.time_zone),
    duration_ms: snapshot.duration_ms,
  }
}

export function apply(ctx, config) {
  const probe = new Probe({ getConfig: () => config, ctx, log: (m) => ctx.logger?.info?.(`[home-assistant] ${m}`) })

  // Touch the probe once at load without blocking startup: a failure here must
  // never stop the host from booting.
  probe.refresh().catch(() => {})

  ctx.inject?.(['systemPrompt'], (scoped) => {
    try {
      const dispose = scoped.systemPrompt.section({
        name: 'home-assistant',
        order: SECTION_ORDER,
        interpolate: false,
        text: () => renderBlock(probe.current(), config),
      })
      scoped.effect?.(() => dispose)
    } catch (error) {
      ctx.logger?.warn?.(`[home-assistant] 无法注册系统提示词段落：${error?.message ?? error}`)
    }
  })

  const tool = {
    name: 'ha_status',
    description:
      'Run one Home Assistant status check: connection, Core/Supervisor/OS versions, core state, recovery mode, watchdog, disk, scale (entities/devices/areas/integrations) and the configured stats. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        refresh: {
          type: 'boolean',
          description: 'Ignore the cache and probe Home Assistant again (default false).',
        },
      },
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        return [{ type: 'text', text: renderStatus(value) }]
      },
    },
    async execute(args) {
      const snapshot = await probe.refresh({ force: args?.refresh === true })
      return publicSnapshot(snapshot)
    },
  }

  try {
    ctx.effect?.(() => ctx.tools.register(tool), 'home-assistant: ha_status')
  } catch (error) {
    ctx.logger?.warn?.(`[home-assistant] 无法注册 ha_status：${error?.message ?? error}`)
  }

  // Same-origin endpoint for the settings card; no secrets leave the host.
  ctx.inject?.(['webServer'], (scoped) => {
    try {
      const dispose = scoped.webServer.register({
        kind: 'exact',
        path: '/dsh-home-assistant/status',
        handler: async (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          try {
            const snapshot = await probe.refresh()
            response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            response.end(JSON.stringify(publicSnapshot(snapshot)))
          } catch (error) {
            response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            response.end(JSON.stringify({ ok: false, hints: [String(error?.message ?? error)] }))
          }
        },
      })
      scoped.effect?.(() => dispose)
    } catch (error) {
      ctx.logger?.warn?.(`[home-assistant] 无法注册状态路由：${error?.message ?? error}`)
    }
  })
}

function renderStatus(snapshot) {
  if (!snapshot) return 'Home Assistant 尚未完成首次探测。'
  const lines = []
  const title = snapshot.label || 'Home Assistant'
  lines.push(`${title} — ${snapshot.url}`)
  if (!snapshot.ok) {
    lines.push(`状态：不可达`)
    for (const hint of snapshot.hints ?? []) if (hint) lines.push(`· ${hint}`)
    return lines.join('\n')
  }
  const version = [
    snapshot.version?.core && `Core ${snapshot.version.core}`,
    snapshot.version?.supervisor && `Supervisor ${snapshot.version.supervisor}`,
    snapshot.version?.os && `OS ${snapshot.version.os}`,
  ].filter(Boolean)
  if (version.length) lines.push(version.join(' ｜ '))
  lines.push(`状态：${snapshot.core_state ?? '未知'}${snapshot.recovery_mode ? '（recovery_mode）' : ''}`)
  const scale = snapshot.scale ?? {}
  const scaleParts = [
    typeof scale.entities === 'number' && `${scale.entities} 实体`,
    typeof scale.devices === 'number' && `${scale.devices} 设备`,
    typeof scale.areas === 'number' && `${scale.areas} 区域`,
    typeof scale.integrations === 'number' && `${scale.integrations} 集成`,
  ].filter(Boolean)
  if (scaleParts.length) lines.push(`规模：${scaleParts.join(' / ')}`)
  if (snapshot.disk?.total_gb) lines.push(`磁盘：已用 ${snapshot.disk.used_gb}/${snapshot.disk.total_gb} GB`)
  for (const stat of snapshot.stats ?? []) lines.push(`· ${stat.title}：${stat.value ?? '—'}`)
  for (const hint of snapshot.hints ?? []) if (hint) lines.push(`提示：${oneLine(hint, 160)}`)
  lines.push(`更新：${snapshot.updated_at}`)
  return lines.join('\n')
}
