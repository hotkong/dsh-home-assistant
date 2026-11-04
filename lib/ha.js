/** Minimal Home Assistant transport: REST over fetch, plus one-shot WebSocket commands. */

export class HaError extends Error {
  /**
   * @param {string} message human-readable, Chinese-first
   * @param {{status?: number, code?: string}} [info]
   */
  constructor(message, info = {}) {
    super(message)
    this.name = 'HaError'
    this.status = info.status
    this.code = info.code
  }
}

function authHeaders(token, extra) {
  const headers = { accept: 'application/json', ...extra }
  if (token) headers.authorization = `Bearer ${token}`
  return headers
}

/**
 * @param {string} url absolute URL
 * @param {{token?: string, timeoutMs?: number, headers?: Record<string,string>, signal?: AbortSignal}} [options]
 */
async function request(url, options = {}) {
  const { token, timeoutMs = 5000, headers, signal, method = 'GET', body } = options
  const signals = []
  if (signal) signals.push(signal)
  if (typeof AbortSignal.timeout === 'function') signals.push(AbortSignal.timeout(timeoutMs))
  try {
    return await fetch(url, {
      method,
      headers: authHeaders(token, body === undefined ? headers : { 'content-type': 'application/json', ...headers }),
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal: signals.length ? AbortSignal.any(signals) : undefined,
    })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new HaError(`请求超时（${Math.round(timeoutMs / 1000)} 秒）：${url}`, { code: 'timeout' })
    }
    throw new HaError(`无法连接 Home Assistant：${url}（${error?.message ?? error}）`, { code: 'unreachable' })
  }
}

/** JSON request; non-2xx becomes a translated HaError. */
export async function restJson(url, options = {}) {
  const response = await request(url, options)
  const text = await response.text()
  if (!response.ok) throw statusError(response.status, text, url)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new HaError(`Home Assistant 返回了非 JSON 响应：${url}`, { code: 'bad-payload', status: response.status })
  }
}

/** Text request (used by `POST /api/template`, which answers with a rendered string). */
export async function restText(url, options = {}) {
  const response = await request(url, options)
  const text = await response.text()
  if (!response.ok) throw statusError(response.status, text, url)
  return text
}

function statusError(status, body, url) {
  let detail = ''
  try {
    const parsed = JSON.parse(body)
    detail = parsed?.message || parsed?.error || ''
  } catch {
    detail = String(body ?? '').slice(0, 200)
  }
  if (status === 401 || status === 403) {
    return new HaError('令牌无效或权限不足（HTTP ' + status + '）：请在设置中重新填写长期访问令牌', { status, code: 'unauthorized' })
  }
  if (status === 404) {
    return new HaError(`Home Assistant 没有这个端点（HTTP 404）：${url}`, { status, code: 'not-found' })
  }
  return new HaError(`Home Assistant 返回 HTTP ${status}${detail ? `：${detail}` : ''}`, { status, code: 'http' })
}

/**
 * Run several WebSocket commands over ONE connection.
 * Each entry resolves independently: a failed command yields `{ok:false, error}`
 * so one missing capability never sinks the whole probe.
 *
 * @param {string} wsUrl e.g. `ws://host:8123/api/websocket`
 * @param {string} token long-lived access token
 * @param {Array<{key: string, type: string, payload?: object}>} calls
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<Record<string, {ok: true, value: unknown} | {ok: false, error: HaError}>>}
 */
export function wsBatch(wsUrl, token, calls, options = {}) {
  const timeoutMs = options.timeoutMs ?? 6000
  return new Promise((resolve) => {
    const results = {}
    const pending = new Map()
    let nextId = 1
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        /* ignore */
      }
      for (const { key } of pending.values()) {
        results[key] = { ok: false, error: new HaError('WebSocket 连接提前关闭', { code: 'closed' }) }
      }
      resolve(results)
    }
    const timer = setTimeout(done, timeoutMs)
    let socket
    try {
      socket = new WebSocket(wsUrl)
    } catch (error) {
      for (const call of calls) {
        results[call.key] = { ok: false, error: new HaError('无法建立 WebSocket 连接', { code: 'unreachable' }) }
      }
      settleNow()
      return
    }
    function settleNow() {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(results)
    }
    socket.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (message.type === 'auth_required') {
        socket.send(JSON.stringify({ type: 'auth', access_token: token }))
        return
      }
      if (message.type === 'auth_invalid') {
        for (const call of calls) results[call.key] = { ok: false, error: new HaError('令牌无效或权限不足：WebSocket 鉴权失败', { code: 'unauthorized' }) }
        done()
        return
      }
      if (message.type === 'auth_ok') {
        for (const call of calls) {
          const id = nextId++
          pending.set(id, { key: call.key })
          socket.send(JSON.stringify({ id, type: call.type, ...(call.payload ?? {}) }))
        }
        return
      }
      if (message.type === 'result' && pending.has(message.id)) {
        const { key } = pending.get(message.id)
        pending.delete(message.id)
        results[key] = message.success
          ? { ok: true, value: message.result }
          : { ok: false, error: new HaError(`Home Assistant 拒绝命令 ${key}：${message.error?.message ?? '未知错误'}`, { code: message.error?.code ?? 'ws' }) }
        if (pending.size === 0) done()
      }
    })
    socket.addEventListener('error', () => {
      for (const call of calls) if (!results[call.key]) results[call.key] = { ok: false, error: new HaError('WebSocket 连接失败', { code: 'unreachable' }) }
      done()
    })
  })
}
