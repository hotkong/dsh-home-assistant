/**
 * Probe Home Assistant and keep one cached snapshot.
 *
 * Design rules (see openspec design ADR-003):
 *  - never block prompt assembly on the network — assembly reads the cache;
 *  - a failed part degrades to `null` and a hint, it never throws upward;
 *  - every request is read-only.
 */

import { restJson, restText, wsBatch, HaError } from './ha.js'
import { resolveToken } from './token.js'
import { val, normalizeUrl } from './util.js'

const MAX_STATS = 6
const STAT_VALUE_MAX = 120

/** http(s)://host:port → ws(s)://host:port/api/websocket */
function websocketUrl(base) {
  try {
    const url = new URL(base)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = '/api/websocket'
    url.search = ''
    return url.toString()
  } catch {
    return ''
  }
}

function str(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function flat(text, max = STAT_VALUE_MAX) {
  const flatText = String(text ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return flatText.length > max ? `${flatText.slice(0, max - 1)}…` : flatText
}

export class Probe {
  /**
   * @param {{getConfig: () => object, ctx?: object, log?: (message: string) => void}} options
   */
  constructor(options) {
    this.getConfig = options.getConfig
    this.ctx = options.ctx ?? {}
    this.log = options.log ?? (() => {})
    this.snapshot = null
    this.inflight = null
    this.failures = 0
  }

  /** Cached snapshot; `null` before the first successful probe. Never awaited. */
  current() {
    const ttl = Math.max(5, Number(val(this.getConfig().status?.refreshSec, 30)) || 30) * 1000
    if (this.snapshot && Date.now() - this.snapshot.at < ttl) return this.snapshot
    this.refresh().catch(() => {})
    return this.snapshot
  }

  /** @param {{force?: boolean}} [options] */
  async refresh(options = {}) {
    const ttl = Math.max(5, Number(val(this.getConfig().status?.refreshSec, 30)) || 30) * 1000
    if (!options.force && this.snapshot && Date.now() - this.snapshot.at < ttl) return this.snapshot
    if (this.inflight) return this.inflight
    this.inflight = this.#run()
      .then((snapshot) => {
        this.snapshot = snapshot
        this.failures = snapshot.ok ? 0 : this.failures + 1
        return snapshot
      })
      .finally(() => {
        this.inflight = null
      })
    return this.inflight
  }

  async #run() {
    const started = Date.now()
    const config = this.getConfig()
    const base = normalizeUrl(val(config.baseUrl, ''))
    const label = str(val(config.label, ''))
    const notes = str(val(config.notes, ''))
    const hints = []
    const snapshot = {
      ok: false,
      at: Date.now(),
      label,
      url: base,
      notes,
      version: { core: null, supervisor: null, os: null },
      core_state: null,
      time_zone: null,
      recovery_mode: null,
      watchdog: null,
      disk: null,
      scale: { entities: null, devices: null, areas: null, integrations: null },
      stats: [],
      hints,
      duration_ms: 0,
      source: 'none',
    }

    if (!base) {
      hints.push('还没有配置 Home Assistant 地址（baseUrl）')
      snapshot.duration_ms = Date.now() - started
      return snapshot
    }

    const { token, source } = await resolveToken(this.ctx, config)
    snapshot.source = source
    if (!token) {
      hints.push('还没有配置长期访问令牌：可设置凭据 HA_TOKEN（推荐）或在设置里填写')
      snapshot.duration_ms = Date.now() - started
      return snapshot
    }

    const timeoutMs = Math.max(1000, Number(val(config.status?.timeoutMs, 5000)) || 5000)
    const showScale = val(config.status?.showScale, true) !== false
    const auth = { token, timeoutMs }

    try {
      await restJson(`${base}/api/`, auth)
      snapshot.ok = true
    } catch (error) {
      hints.push(error instanceof HaError ? error.message : String(error))
      snapshot.duration_ms = Date.now() - started
      return snapshot
    }

    try {
      const conf = await restJson(`${base}/api/config`, auth)
      snapshot.core_state = str(conf?.state) || null
      snapshot.recovery_mode = typeof conf?.recovery_mode === 'boolean' ? conf.recovery_mode : null
      snapshot.time_zone = str(conf?.time_zone) || null
      if (!snapshot.label && conf?.location_name) snapshot.label = str(conf.location_name)
    } catch (error) {
      hints.push(`无法读取 /api/config：${error instanceof HaError ? error.message : error}`)
    }

    let states = null
    try {
      states = await restJson(`${base}/api/states`, auth)
      if (Array.isArray(states)) snapshot.scale.entities = states.length
      else states = null
    } catch (error) {
      hints.push(`无法读取实体列表：${error instanceof HaError ? error.message : error}`)
    }

    const wsUrl = websocketUrl(base)
    if (wsUrl) {
      const registries = showScale
        ? [
            { key: 'devices', type: 'config/device_registry/list' },
            { key: 'areas', type: 'config/area_registry/list' },
            { key: 'integrations', type: 'config_entries/get' },
          ]
        : []
      const supervisor = [
        { key: 'core', type: 'supervisor/api', payload: { endpoint: '/core/info', method: 'get' } },
        { key: 'supervisor', type: 'supervisor/api', payload: { endpoint: '/supervisor/info', method: 'get' } },
        { key: 'os', type: 'supervisor/api', payload: { endpoint: '/os/info', method: 'get' } },
        { key: 'host', type: 'supervisor/api', payload: { endpoint: '/host/info', method: 'get' } },
      ]
      const results = await wsBatch(wsUrl, token, [...registries, ...supervisor], { timeoutMs })
      const count = (key) => (results[key]?.ok && Array.isArray(results[key].value) ? results[key].value.length : null)
      if (showScale) {
        snapshot.scale.devices = count('devices')
        snapshot.scale.areas = count('areas')
        snapshot.scale.integrations = count('integrations')
      }
      if (results.core?.ok) {
        snapshot.version.core = str(results.core.value?.version) || null
        snapshot.watchdog = typeof results.core.value?.watchdog === 'boolean' ? results.core.value.watchdog : null
      }
      if (results.supervisor?.ok) snapshot.version.supervisor = str(results.supervisor.value?.version) || null
      if (results.os?.ok) snapshot.version.os = str(results.os.value?.version) || null
      if (results.host?.ok) {
        const host = results.host.value ?? {}
        if (typeof host.disk_used === 'number' && typeof host.disk_total === 'number') {
          snapshot.disk = { used_gb: host.disk_used, free_gb: host.disk_free ?? null, total_gb: host.disk_total }
        }
      }
    }

    if (!snapshot.version.core && Array.isArray(states)) {
      const version = fromUpdateEntity(states, 'update.home_assistant_core_update')
      if (version) snapshot.version.core = version
    }
    if (!snapshot.version.supervisor && Array.isArray(states)) {
      snapshot.version.supervisor = fromUpdateEntity(states, 'update.home_assistant_supervisor_update')
    }
    if (!snapshot.version.os && Array.isArray(states)) {
      snapshot.version.os = fromUpdateEntity(states, 'update.home_assistant_operating_system_update')
    }

    snapshot.stats = await this.#probeStats(base, auth, config)
    for (const stat of snapshot.stats) if (!stat.ok) hints.push(`观测项「${stat.title}」取不到值`)
    if (snapshot.recovery_mode === true) hints.push('Home Assistant 处于 recovery_mode：只加载了最小配置')

    snapshot.duration_ms = Date.now() - started
    return snapshot
  }

  async #probeStats(base, auth, config) {
    const configured = Array.isArray(config.stats) ? config.stats : []
    const items = configured.slice(0, MAX_STATS).map((item) => ({
      title: str(item?.title) || '未命名',
      entity: str(item?.entity),
      attribute: str(item?.attribute),
      template: str(item?.template),
      unit: str(item?.unit),
    }))
    const results = await Promise.all(
      items.map(async (item) => {
        try {
          if (item.entity) {
            const state = await restJson(`${base}/api/states/${encodeURIComponent(item.entity)}`, auth)
            if (!state) throw new HaError(`实体 ${item.entity} 不存在`, { code: 'not-found' })
            const raw = item.attribute ? state.attributes?.[item.attribute] : state.state
            if (raw === undefined || raw === null) throw new HaError(`实体 ${item.entity} 没有属性 ${item.attribute}`, { code: 'not-found' })
            return { title: item.title, value: `${flat(raw)}${item.unit}`.trim(), ok: true }
          }
          if (item.template) {
            const text = await restText(`${base}/api/template`, {
              ...auth,
              method: 'POST',
              body: { template: item.template },
            })
            return { title: item.title, value: `${flat(text)}${item.unit}`.trim(), ok: true }
          }
          return { title: item.title, value: '—', ok: false }
        } catch (error) {
          return { title: item.title, value: '—', ok: false, error: error instanceof HaError ? error.message : String(error) }
        }
      }),
    )
    return results
  }
}

function fromUpdateEntity(states, entityId) {
  const found = states.find((s) => s?.entity_id === entityId)
  const version = found?.attributes?.installed_version
  return typeof version === 'string' && version ? version : null
}
