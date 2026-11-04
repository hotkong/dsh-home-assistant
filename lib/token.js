/**
 * Token resolution.
 *
 * Order: inline `token` (escape hatch) → credential reference (`tokenRef`,
 * defaults to `HA_TOKEN`) resolved through `ctx.credentials`, with a plain
 * environment fallback so headless runs work too.
 *
 * Resolved per operation, never cached: rotating the credential takes effect on
 * the next call without restarting the host.
 */

import { val } from './util.js'

const DEFAULT_REF = 'HA_TOKEN'

/**
 * @param {object} ctx cordis context
 * @param {object} config live plugin configuration
 * @returns {Promise<{token: string, source: string}>}
 */
export async function resolveToken(ctx, config) {
  const inline = val(config.token, '')
  if (typeof inline === 'string' && inline.trim()) {
    return { token: inline.trim(), source: 'inline' }
  }

  const ref = String(val(config.tokenRef, '') || DEFAULT_REF).trim() || DEFAULT_REF

  const credentials = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
  if (credentials && typeof credentials.resolve === 'function') {
    try {
      const hit = await credentials.resolve(ref)
      if (hit && typeof hit.value === 'string' && hit.value.trim()) {
        return { token: hit.value.trim(), source: `credential:${ref}` }
      }
    } catch {
      // fall through to the environment
    }
  }

  const ambient = process.env[ref]
  if (typeof ambient === 'string' && ambient.trim()) {
    return { token: ambient.trim(), source: `env:${ref}` }
  }

  return { token: '', source: 'none' }
}
