/**
 * Render the `<home_assistant>` block that goes into the system prompt.
 *
 * Requirements: one section, ≤ `inject.maxChars`, no token, no newlines inside
 * a line, `interpolate:false` at the call site so `{{…}}` in user notes stays
 * literal.
 */

import { val, formatDuration, localTime, oneLine } from './util.js'

const BLOCK_OPEN = '<home_assistant'
const BLOCK_CLOSE = '</home_assistant>'

function versionLine(version) {
  const parts = []
  if (version.core) parts.push(`Core ${version.core}`)
  if (version.supervisor) parts.push(`Supervisor ${version.supervisor}`)
  if (version.os) parts.push(`OS ${version.os}`)
  return parts.join(' ｜ ')
}

function scaleLine(scale) {
  const parts = []
  if (typeof scale.entities === 'number') parts.push(`${scale.entities} 实体`)
  if (typeof scale.devices === 'number') parts.push(`${scale.devices} 设备`)
  if (typeof scale.areas === 'number') parts.push(`${scale.areas} 区域`)
  if (typeof scale.integrations === 'number') parts.push(`${scale.integrations} 集成`)
  return parts.join(' / ')
}

function statsLine(stats) {
  const usable = stats.filter((stat) => stat && stat.value && stat.value !== '—')
  if (!usable.length) return ''
  return usable.map((stat) => `${stat.title} ${stat.value}`).join(' ｜ ')
}

/** Normalise one workspace path: trim and drop trailing slashes. */
function normalizeWorkspace(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const trimmed = text.replace(/\/+$/, '')
  return trimmed || '/'
}

/**
 * The workspace a turn belongs to.
 *
 * `AssembleContext` documents only `scope`/`signal`, but the agent loop builds
 * it with the live agent, whose session header carries the durable cwd. Read it
 * defensively: an unknown workspace must not crash prompt assembly, and the
 * caller decides whether an unknown cwd means "inject" or "skip".
 */
export function sessionWorkspace(context) {
  try {
    const cwd = context?.agent?.session?.header?.cwd
    return typeof cwd === 'string' ? normalizeWorkspace(cwd) : ''
  } catch {
    return ''
  }
}

/** Empty allowlist means every workspace; a non-empty one must match by path prefix. */
function allowsWorkspace(workspaces, cwd) {
  const list = Array.isArray(workspaces) ? workspaces.map(normalizeWorkspace).filter(Boolean) : []
  if (!list.length) return true
  if (!cwd) return false
  return list.some((root) => cwd === root || cwd.startsWith(`${root}/`))
}

/**
 * @param {object|null} snapshot probe snapshot (`null` before the first success)
 * @param {object} config live plugin configuration (raw or readConfig output)
 * @param {{agent?: {session?: {header?: {cwd?: string}}}}} [context] prompt assembly context
 * @returns {string} the block, or '' when injection is disabled or outside the allowlist
 */
export function renderBlock(snapshot, config, context) {
  const inject = config.inject ?? {}
  if (val(inject.enabled, true) === false) return ''
  const workspaces = val(inject.workspaces, [])
  if (!allowsWorkspace(workspaces, sessionWorkspace(context))) return ''
  const maxChars = Math.max(200, Number(val(inject.maxChars, 600)) || 600)

  const label = snapshot?.label || val(config.label, '') || 'Home Assistant'
  const url = snapshot?.url || val(config.baseUrl, '') || ''
  const head = `${BLOCK_OPEN} label="${oneLine(label, 60)}" url="${oneLine(url, 120)}">`

  if (!snapshot) {
    return `${head}\n状态：正在首次探测…\n${BLOCK_CLOSE}`
  }

  if (!snapshot.ok) {
    const reason = (snapshot.hints ?? []).find(Boolean) ?? '不可达'
    return `${head}\n⚠️ 不可达：${oneLine(reason, 160)}\n更新：${localTime(new Date(snapshot.at), snapshot.time_zone)}\n${BLOCK_CLOSE}`
  }

  const lines = [head]
  const versions = versionLine(snapshot.version ?? {})
  if (versions) lines.push(versions)
  const state = snapshot.core_state ? `${snapshot.core_state}` : '未知'
  const flags = []
  if (typeof snapshot.recovery_mode === 'boolean') flags.push(`recovery_mode=${snapshot.recovery_mode}`)
  if (typeof snapshot.watchdog === 'boolean') flags.push(`watchdog=${snapshot.watchdog}`)
  lines.push(`状态：${state}${flags.length ? `（${flags.join('，')}）` : ''}`)
  const scale = scaleLine(snapshot.scale ?? {})
  if (scale) lines.push(`规模：${scale}`)
  if (snapshot.disk?.total_gb) lines.push(`磁盘：已用 ${snapshot.disk.used_gb}/${snapshot.disk.total_gb} GB`)
  const stats = statsLine(snapshot.stats ?? [])
  if (stats) lines.push(`统计：${stats}`)
  const notes = oneLine(val(config.notes, '') || snapshot.notes, 200)
  if (notes) lines.push(`备注：${notes}`)
  lines.push(`更新：${localTime(new Date(snapshot.at), snapshot.time_zone)}`)
  lines.push(BLOCK_CLOSE)

  let block = lines.join('\n')
  if (block.length > maxChars) {
    // Keep the head and the freshness line; drop the middle.
    const trimmed = [lines[0], lines.slice(1, 2).join(''), '…（内容过长已截断）', lines[lines.length - 2], lines[lines.length - 1]]
    block = trimmed.filter(Boolean).join('\n').slice(0, maxChars)
  }
  return block
}
