/** Small shared helpers. No third-party dependencies. */

/** Read a cordis/schemastery field: `.volatile()` fields are accessors. */
export function val(field, fallback) {
  if (field === undefined || field === null) return fallback
  if (typeof field === 'object' && typeof field.get === 'function') {
    const v = field.get()
    return v === undefined || v === null ? fallback : v
  }
  return field
}

/** Trim trailing slashes so `new URL()` joins predictably. */
export function normalizeUrl(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  return text.replace(/\/+$/, '')
}

/** `1h2m` / `42s` — coarse, for a prompt block. */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const s = Math.floor(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h < 24) return mm ? `${h}h${mm}m` : `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d${h % 24}h`
}

/** Collapse whitespace and cap length — prompt blocks must stay one line each. */
export function oneLine(text, max = 120) {
  const flat = String(text ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!flat) return ''
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Mask anything shaped like a JWT / long secret before it reaches a log or a prompt. */
export function redact(text) {
  return String(text ?? '')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '***')
    .replace(/\b[A-Fa-f0-9]{64,}\b/g, '***')
}

/**
 * Time in a specific zone with an explicit offset, e.g. `2026-11-04 16:10 (+08:00)`.
 * Defaults to the process zone; pass Home Assistant's `time_zone` so the block
 * matches what the user sees in their own UI.
 */
export function localTime(date = new Date(), timeZone) {
  const pad = (n) => String(n).padStart(2, '0')
  let stamp
  let offsetMin = -date.getTimezoneOffset()
  try {
    if (timeZone) {
      const parts = new Intl.DateTimeFormat('sv-SE', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(date)
      const get = (type) => parts.find((part) => part.type === type)?.value ?? '00'
      stamp = `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
      const named = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(date)
      const raw = named.find((part) => part.type === 'timeZoneName')?.value ?? ''
      const match = /GMT([+-])(\d{2}):(\d{2})/.exec(raw)
      if (match) offsetMin = (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    }
  } catch {
    /* fall back to the process zone */
  }
  if (!stamp) {
    stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  return `${stamp} (${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`
}

/** Round to at most one decimal, dropping a useless trailing `.0`. */
export function formatNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value ?? '')
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10)
}
