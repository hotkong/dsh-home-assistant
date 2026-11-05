/**
 * dsh-home-assistant — configure a Home Assistant instance once, and let every
 * session start already knowing where it is, what version it runs and how it is
 * doing.
 *
 * Wiring: one system-prompt section, one read-only tool, one same-origin status
 * route for the client half, and the client half itself (a settings page that
 * pairs the live status card with the configuration form). Every registration
 * is fail-safe: a wiring error logs and leaves the rest of the host untouched.
 */

import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Probe } from './probe.js'
import { renderBlock, sessionWorkspace } from './prompt.js'
import { val, localTime, oneLine } from './util.js'

/**
 * Optional boot breadcrumb. DSH's boot failure screen is the only place a load
 * error shows up and it is not always reachable, so `DSH_HOME_ASSISTANT_DEBUG=1`
 * records whether the module was imported and how far wiring got. Off by
 * default: a working plugin must not write files just by being loaded.
 */
const TRACE_ENABLED = process.env.DSH_HOME_ASSISTANT_DEBUG === '1'
const TRACE_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-home-assistant-boot.log')
function trace(line) {
  if (!TRACE_ENABLED) return
  try {
    appendFileSync(TRACE_FILE, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* tracing must never be the reason a boot fails */
  }
}
trace('import')

export const name = 'home-assistant'
export const inject = ['tools']

/** Section order: after the tool instructions, before the trailing tail sections. */
const SECTION_ORDER = 900

/**
 * Config schema, loaded lazily and defensively.
 *
 * Every field is `volatile()`: the host's settings service only lets the web UI
 * edit fields below a volatile ancestor, and a live edit must reach the next
 * prompt assembly without remounting the plugin. If
 * `@deepseek-ai/schemastery` cannot be resolved the plugin still loads (tools +
 * injection keep working) and only the web form disappears.
 */
let Config
try {
  const { default: Schema } = await import('@deepseek-ai/schemastery')
  Config = Schema.object({
    baseUrl: Schema.string().default('http://homeassistant.local:8123').description('Home Assistant 地址（含端口）').volatile(),
    tokenRef: Schema.string().default('HA_TOKEN').description('凭据引用名').volatile(),
    token: Schema.string().role('secret').default('').description('内联长期访问令牌，仅作兜底').volatile(),
    label: Schema.string().default('').description('显示名').volatile(),
    notes: Schema.string().default('').description('自由备注，会进入注入块').volatile(),
    stats: Schema.array(
      Schema.object({
        title: Schema.string().default(''),
        entity: Schema.string().default(''),
        attribute: Schema.string().default(''),
        template: Schema.string().default(''),
        unit: Schema.string().default(''),
      }),
    )
      .default([])
      .description('1–6 个观测项')
      .volatile(),
    inject: Schema.object({
      enabled: Schema.boolean().default(true).volatile(),
      workspaces: Schema.array(Schema.string())
        .default([])
        .description('仅在以下工作区自动注入；空数组 = 所有工作区')
        .volatile(),
      refreshSec: Schema.number().default(60).volatile(),
      maxChars: Schema.number().default(600).volatile(),
    }).default({}),
    status: Schema.object({
      refreshSec: Schema.number().default(30).volatile(),
      timeoutMs: Schema.number().default(5000).volatile(),
      showScale: Schema.boolean().default(true).volatile(),
    }).default({}),
    notify: Schema.object({
      enabled: Schema.boolean().default(false).volatile(),
      onDown: Schema.boolean().default(true).volatile(),
      onRecover: Schema.boolean().default(true).volatile(),
      failureThreshold: Schema.number().default(2).volatile(),
    }).default({}),
  })
} catch {
  Config = undefined
}
export { Config }

/** Read one config group whether it is plain (`{field}`) or itself volatile. */
function readGroup(value) {
  const group = val(value, {})
  return group && typeof group === 'object' ? group : {}
}

/** Normalise config for both shapes: schemastery accessors or a plain object. */
function readConfig(config) {
  const inject = readGroup(config?.inject)
  const status = readGroup(config?.status)
  const notify = readGroup(config?.notify)
  const stats = val(config?.stats, [])
  const workspaces = val(inject.workspaces, [])
  return {
    baseUrl: val(config?.baseUrl, ''),
    tokenRef: val(config?.tokenRef, '') || 'HA_TOKEN',
    token: val(config?.token, ''),
    label: val(config?.label, ''),
    notes: val(config?.notes, ''),
    stats: Array.isArray(stats) ? stats : [],
    inject: {
      enabled: val(inject.enabled, true) !== false,
      workspaces: Array.isArray(workspaces) ? workspaces.filter((item) => typeof item === 'string' && item.trim()) : [],
      refreshSec: Number(val(inject.refreshSec, 60)) || 60,
      maxChars: Number(val(inject.maxChars, 600)) || 600,
    },
    status: {
      refreshSec: Number(val(status.refreshSec, 30)) || 30,
      timeoutMs: Number(val(status.timeoutMs, 5000)) || 5000,
      showScale: val(status.showScale, true) !== false,
    },
    notify: {
      enabled: val(notify.enabled, false) === true,
      onDown: val(notify.onDown, true) !== false,
      onRecover: val(notify.onRecover, true) !== false,
      failureThreshold: Math.max(1, Number(val(notify.failureThreshold, 2)) || 2),
    },
  }
}

function publicSnapshot(snapshot, workspace) {
  if (!snapshot) return { ok: false, pending: true, hints: ['正在首次探测 Home Assistant…'], updated_at: null, workspace: workspace || null }
  return {
    ok: snapshot.ok,
    label: snapshot.label,
    url: snapshot.url,
    configured: Boolean(snapshot.url),
    // Which credential source answered — a reference name, never the secret.
    auth_source: snapshot.source,
    // Workspace of the most recent prompt assembly; drives the injection allowlist.
    workspace: workspace || null,
    version: snapshot.version,
    core_state: snapshot.core_state,
    time_zone: snapshot.time_zone,
    recovery_mode: snapshot.recovery_mode,
    watchdog: snapshot.watchdog,
    disk: snapshot.disk,
    scale: snapshot.scale,
    stats: snapshot.stats,
    hints: snapshot.hints,
    updated_at: localTime(new Date(snapshot.at), snapshot.time_zone),
    duration_ms: snapshot.duration_ms,
  }
}

/**
 * Run one wiring step, but never let its error reach cordis.
 *
 * A hot reload re-applies the plugin before the previous registration is
 * necessarily disposed, and `tools.register` rejects a duplicate name. That
 * rejection does not just fail our step — cordis marks the whole fiber FAILED,
 * and the next boot refuses to start. Swallowing it here keeps the fiber
 * healthy; the step simply does nothing until the next reload.
 */
function safe(step, fn) {
  try {
    return fn()
  } catch (error) {
    trace(`${step}-fail: ${error?.message ?? error}`)
    return undefined
  }
}

/** Read a small JSON request body; the token route is the only writer. */
function readJsonBody(request, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function wire(ctx, config) {
  const probe = new Probe({ getConfig: () => readConfig(config), ctx })
  // Last workspace seen during prompt assembly; exposed by the status route so
  // the allowlist is diagnosable without guessing why the block is absent.
  let lastWorkspace = ''

  // Prime the cache without blocking startup; a failure here is never fatal.
  try {
    probe.refresh().catch(() => {})
  } catch {
    /* probe is best-effort by design */
  }

  safe('system-prompt-inject', () => ctx.inject(['systemPrompt'], (scoped) => {
    try {
      const dispose = scoped.systemPrompt.section({
        name: 'home-assistant',
        order: SECTION_ORDER,
        interpolate: false,
        text: (context) => {
          lastWorkspace = sessionWorkspace(context)
          return renderBlock(probe.current(), readConfig(config), context)
        },
      })
      safe('section-effect', () => scoped.effect?.(() => dispose))
    } catch (error) {
      trace(`section-fail: ${error?.message ?? error}`)
      ctx.logger?.warn?.(`[home-assistant] 无法注册系统提示词段落：${error?.message ?? error}`)
    }
  }))

  const tool = {
    name: 'ha_status',
    description:
      'Run one Home Assistant status check: connection, Core/Supervisor/OS versions, core state, recovery mode, watchdog, disk, scale and the configured stats. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean', description: 'Ignore the cache and probe Home Assistant again (default false).' },
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
      return publicSnapshot(snapshot, lastWorkspace)
    },
  }

  safe('tool-effect', () =>
    ctx.effect?.(() => {
      let dispose
      let timer
      // A hot reload can re-apply before the previous registration is disposed.
      // Retry briefly instead of giving up, so the tool survives a reload.
      const attempt = (round) => {
        if (typeof dispose === 'function') return
        dispose = safe('tool-register', () => ctx.tools.register(tool))
        if (typeof dispose === 'function') return
        if (round < 4) timer = setTimeout(() => attempt(round + 1), 400)
      }
      attempt(0)
      return () => {
        if (timer) clearTimeout(timer)
        if (typeof dispose === 'function') dispose()
      }
    }),
  )

  // Read-only endpoint for the Settings tab. Same-origin, no secrets leave the host.
  safe('route-inject', () => ctx.inject(['webServer'], (scoped) => {
    try {
      const dispose = scoped.webServer.register({
        kind: 'exact',
        path: '/dsh-home-assistant/status',
        handler: async (request, response) => {
          const send = (payload) => {
            response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            response.end(JSON.stringify(payload))
          }
          if (request.method !== 'GET') {
            response.writeHead(405, { allow: 'GET' })
            response.end()
            return
          }
          try {
            const url = new URL(request.url ?? '/', 'http://localhost')
            const force = ['1', 'true', 'yes'].includes((url.searchParams.get('refresh') ?? '').toLowerCase())
            send(publicSnapshot(await probe.refresh({ force }), lastWorkspace))
          } catch (error) {
            send({ ok: false, hints: [String(error?.message ?? error)] })
          }
        },
      })
      safe('route-effect', () => scoped.effect?.(() => dispose))
    } catch (error) {
      trace(`route-fail: ${error?.message ?? error}`)
      ctx.logger?.warn?.("[home-assistant] 无法注册状态路由：" + (error?.message ?? error))
    }
  }))

  // Token editor endpoint. The browser never talks to the credential service
  // directly: a missing browser-side service must not break the client boot, and
  // the Node half already owns the same-origin surface used by the status card.
  safe('token-route-inject', () => ctx.inject(['webServer'], (scoped) => {
    try {
      const dispose = scoped.webServer.register({
        kind: 'exact',
        path: '/dsh-home-assistant/token',
        handler: async (request, response) => {
          const send = (status, payload) => {
            response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            response.end(JSON.stringify(payload))
          }
          const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
          const ref = String(readConfig(config).tokenRef || 'HA_TOKEN').trim() || 'HA_TOKEN'
          if (!credentials) {
            send(503, { ok: false, ref, error: '宿主没有提供凭据服务' })
            return
          }
          try {
            if (request.method === 'GET') {
              const info = await credentials.describe(ref)
              send(200, { ok: true, ref, configured: info?.configured === true, writable: info?.writable !== false })
              return
            }
            if (request.method === 'POST') {
              const text = await readJsonBody(request)
              let payload
              try {
                payload = JSON.parse(text || '{}')
              } catch {
                send(400, { ok: false, ref, error: '请求体必须是 JSON' })
                return
              }
              const token = typeof payload?.token === 'string' ? payload.token.trim() : ''
              if (token.length < 8) {
                send(400, { ok: false, ref, error: '令牌为空或过短' })
                return
              }
              if (token.length > 4096) {
                send(400, { ok: false, ref, error: '令牌过长' })
                return
              }
              await credentials.set(ref, token)
              send(200, { ok: true, ref, configured: true })
              return
            }
            if (request.method === 'DELETE') {
              await credentials.unset(ref)
              send(200, { ok: true, ref, configured: false })
              return
            }
            response.writeHead(405, { allow: 'GET, POST, DELETE' })
            response.end()
          } catch (error) {
            send(500, { ok: false, ref, error: String(error?.message ?? error) })
          }
        },
      })
      safe('token-route-effect', () => scoped.effect?.(() => dispose))
    } catch (error) {
      trace(`token-route-fail: ${error?.message ?? error}`)
      ctx.logger?.warn?.("[home-assistant] 无法注册令牌路由：" + (error?.message ?? error))
    }
  }))
}

/**
 * Fail-safe entry. DSH boots all-or-nothing: one entry that throws during
 * activation stops the whole web profile. A status panel must never be able to
 * do that, so every wiring failure is swallowed and the plugin goes inert.
 */
export function apply(ctx, config) {
  trace('apply-enter')
  try {
    wire(ctx, config)
    trace('apply-ok')
  } catch (error) {
    try {
      trace(`apply-fail: ${error?.message ?? error}`)
      ctx.logger?.warn?.(`[home-assistant] 插件未启用（装配失败，已隔离）：${error?.message ?? error}`)
    } catch {
      /* the host's logger is unavailable too; nothing else to do */
    }
  }
}

function renderStatus(snapshot) {
  if (!snapshot) return 'Home Assistant 尚未完成首次探测。'
  const lines = []
  lines.push(`${snapshot.label || 'Home Assistant'} — ${snapshot.url}`)
  if (!snapshot.ok) {
    lines.push('状态：不可达')
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
