#!/usr/bin/env node
/**
 * Offline harness for the browser half: mount `client/client.js` against a fake
 * module loader, a minimal React stand-in and fake `slots` / `configForms`
 * services — then render the registered settings page once. It catches syntax
 * errors, wrong service names and render crashes without a browser.
 *
 *   node test/client.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'client', 'client.js')

const source = readFileSync(clientPath, 'utf8')
/**
 * Static guard for the class of bug that broke web boot: reading a ctx service
 * that was never declared in inject. Cordis throws at apply time, and the fake
 * context below cannot reproduce that, so check the source itself.
 */
const injectMatch = /inject:\s*\[([^\]]*)\]/.exec(source)
if (injectMatch === null) {
  console.error('FAIL: could not find the plugin inject declaration')
  process.exit(1)
}
const injected = new Set([...injectMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]))
const accessed = new Set([...source.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]))
for (const name of accessed) {
  if (name === 'get' || name === 'inject' || name === 'effect') continue
  if (!injected.has(name)) {
    console.error(`FAIL: ctx.${name} is read but "${name}" is not declared in inject [${[...injected].join(', ')}]`)
    process.exit(1)
  }
}

/** Minimal React: enough for the module's hooks to run outside a browser. */
const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useCallback(fn) {
    return fn
  },
  useRef(value) {
    return { current: value }
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
}

let registration
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      registration = value
    },
  },
}

await import(`${pathToFileURL(clientPath).href}?t=${Date.now()}`)
if (!registration || registration.id !== 'dsh-home-assistant') {
  console.error('FAIL: client bundle did not register itself as dsh-home-assistant')
  process.exit(1)
}

const plugin = registration.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error(`unexpected require(${JSON.stringify(specifier)})`)
})
if (plugin.name !== 'home-assistant') {
  console.error('FAIL: unexpected client plugin name', plugin.name)
  process.exit(1)
}
if (!Array.isArray(plugin.inject) || !plugin.inject.includes('slots') || !plugin.inject.includes('configForms')) {
  console.error('FAIL: client plugin must inject slots and configForms, got', plugin.inject)
  process.exit(1)
}

const value = {
  baseUrl: 'http://homeassistant.local:8123',
  tokenRef: 'HA_TOKEN',
  label: '客厅 HA',
  notes: '重启约 4.5–5 分钟',
  stats: [{ title: '亮灯数', entity: '', attribute: '', template: '{{ 1 }}', unit: '' }],
  inject: { enabled: true, workspaces: ['/data/dsh/home/homeassistant'], refreshSec: 60, maxChars: 600 },
  status: { refreshSec: 30, timeoutMs: 5000, showScale: true },
}
const form = {
  getSnapshot: () => ({ status: 'ready', value, revision: 0, writable: true }),
  subscribe: () => () => {},
  mutate: async () => true,
}

const credentials = {
  describe: async () => ({ ok: true, value: { HA_TOKEN: { configured: true, writable: true } } }),
  set: async () => ({ ok: true }),
  unset: async () => ({ ok: true }),
}

const registered = []
const sidebar = { definition: null, body: null, title: null }
const mainPanel = { entry: null, page: null }
const tabs = {
  register(definition) {
    sidebar.definition = definition
    return () => {}
  },
}
const ctx = {
  remote: { credentials },
  get(name) {
    if (name === 'remote') return { credentials }
    if (name === 'remote.credentials') return credentials
    return undefined
  },
  inject(names, callback) {
    if (Array.isArray(names) && names.includes('sidebarRightTabs')) {
      return callback({
        get(name) {
          return name === 'sidebarRightTabs' ? tabs : undefined
        },
      })
    }
    return undefined
  },
  effect(fn) {
    return fn()
  },
  configForms: { get: (id) => (id === 'home-assistant' ? form : undefined) },
  slots: {
    inject(name, cb) {
      if (!['settings.section', 'sidebar.right.pane.tab', 'sidebar.right.pane.tab.title', 'sidebar.panellist', 'main'].includes(name)) {
        throw new Error(`unexpected slot ${name}`)
      }
      return cb()
    },
    register(entry, component) {
      registered.push({ entry, component })
      if (entry.name === 'sidebar.right.pane.tab') sidebar.body = component
      if (entry.name === 'sidebar.right.pane.tab.title') sidebar.title = component
      if (entry.name === 'sidebar.panellist') mainPanel.entry = entry
      if (entry.name === 'main') mainPanel.page = component
      return () => {}
    },
  },
}

plugin.apply(ctx)
const settings = registered.find((row) => row.entry.name === 'settings.section')
if (!settings || registered.length !== 5) {
  console.error(`FAIL: expected settings + right tab + left panel registrations, got ${registered.map((row) => row.entry.name)}`)
  process.exit(1)
}
const { entry, component } = settings
if (entry.id !== 'home-assistant' || typeof entry.label !== 'function' || entry.label() !== 'Home Assistant') {
  console.error('FAIL: unexpected registration', entry)
  process.exit(1)
}
if (!sidebar.definition || sidebar.definition.id !== 'dsh-home-assistant' || sidebar.definition.kind !== 'dsh-home-assistant') {
  console.error('FAIL: right-sidebar tab type was not registered', sidebar.definition)
  process.exit(1)
}
if (!sidebar.body || !sidebar.title) {
  console.error('FAIL: right-sidebar body/title slots were not registered')
  process.exit(1)
}
if (!mainPanel.entry || mainPanel.entry.id !== 'home-assistant' || !mainPanel.page) {
  console.error('FAIL: left sidebar entry/main panel were not registered', mainPanel)
  process.exit(1)
}

/** Expand function components and collect every rendered text/attribute. */
function render(node, out) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) {
    for (const child of node) render(child, out)
    return
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.text.push(String(node))
    return
  }
  if (typeof node.type === 'function') {
    render(node.type(node.props ?? {}), out)
    return
  }
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (key === 'children') render(value, out)
    else if (key === 'value' || key === 'placeholder' || key === 'href') out[key].push(String(value))
  }
  render(node.props?.children, out)
}

const out = { text: [], value: [], placeholder: [], href: [] }
try {
  render(component({}), out)
} catch (error) {
  console.error('FAIL: settings page failed to render:', error)
  process.exit(1)
}

const text = out.text.join(' ')
for (const expected of ['Home Assistant', '保存配置', '实例地址 baseUrl', '观测项', '显示与系统提示词注入', '显示名 label', '备注 notes', '状态探测', '浏览器通知', '启用浏览器通知', '发送测试通知', '连续失败次数', '仅在以下工作区自动注入', '访问令牌', '长期访问令牌保存在 DSH 凭据库', '还没有保存令牌']) {
  if (!text.includes(expected)) {
    console.error(`FAIL: rendered page is missing ${JSON.stringify(expected)}:\n${text}`)
    process.exit(1)
  }
}
if (!out.value.includes('http://homeassistant.local:8123') || !out.value.includes('客厅 HA')) {
  console.error('FAIL: configuration inputs were not populated from the form snapshot:', out.value)
  process.exit(1)
}
if (!out.value.includes('/data/dsh/home/homeassistant')) {
  console.error('FAIL: workspace allowlist textarea was not populated:', out.value)
  process.exit(1)
}
if (!out.placeholder.includes('http://homeassistant.local:8123')) {
  console.error('FAIL: baseUrl placeholder missing')
  process.exit(1)
}

const sidebarOut = { text: [], value: [], placeholder: [], href: [] }
try {
  render(sidebar.body({}), sidebarOut)
  render(sidebar.title({}), sidebarOut)
} catch (error) {
  console.error('FAIL: right-sidebar panel failed to render:', error)
  process.exit(1)
}
const sidebarText = sidebarOut.text.join(' ')
for (const expected of ['Home Assistant', '刷新', '配置：设置 → Home Assistant']) {
  if (!sidebarText.includes(expected)) {
    console.error(`FAIL: sidebar panel is missing ${JSON.stringify(expected)}:\n${sidebarText}`)
    process.exit(1)
  }
}

const mainOut = { text: [], value: [], placeholder: [], href: [] }
try {
  render(mainPanel.page({}), mainOut)
} catch (error) {
  console.error('FAIL: left main panel failed to render:', error)
  process.exit(1)
}
const mainText = mainOut.text.join(' ')
for (const expected of ['Home Assistant', '只读状态总览', '设置 → Home Assistant']) {
  if (!mainText.includes(expected)) {
    console.error(`FAIL: left main panel is missing ${JSON.stringify(expected)}:\n${mainText}`)
    process.exit(1)
  }
}

// A host without the credentials service must not fail the whole page: apply
// only needs slots/configForms, and the token editor degrades to a notice.
const registeredWithoutCredentials = []
const minimalCtx = {
  configForms: { get: (id) => (id === 'home-assistant' ? form : undefined) },
  slots: {
    inject: (_name, cb) => cb(),
    register: (entry, component) => {
      registeredWithoutCredentials.push({ entry, component })
      return () => {}
    },
  },
}
try {
  plugin.apply(minimalCtx)
} catch (error) {
  console.error('FAIL: client apply threw without the optional credentials service:', error)
  process.exit(1)
}
if (!registeredWithoutCredentials.some((row) => row.entry.name === 'settings.section')) {
  console.error('FAIL: settings.section was not registered without credentials')
  process.exit(1)
}

// The status notifier is the only piece with timers and browser APIs. Exercise
// its baseline -> down -> recovered transitions with a tiny fake environment.
const notifyValue = {
  ...value,
  notify: {
    enabled: true,
    onDown: true,
    onRecover: true,
    failureThreshold: 1,
  },
}
const notifyForm = {
  getSnapshot: () => ({ status: 'ready', value: notifyValue, revision: 0, writable: true }),
  subscribe: () => () => {},
  mutate: async () => true,
}
const notifications = []
const notifyCleanups = []
class FakeNotification {
  static permission = 'granted'
  static requestPermission = async () => 'granted'
  constructor(title, options) {
    this.title = title
    this.options = options
    notifications.push({ title, options })
  }
  close() {}
}
const localStore = new Map()
const notifyListeners = {}
const previousDocument = globalThis.document
globalThis.document = {
  visibilityState: 'hidden',
  hasFocus: () => false,
  addEventListener: (name, callback) => {
    notifyListeners[name] = callback
  },
  removeEventListener: () => {},
}
window.Notification = FakeNotification
window.localStorage = {
  getItem: (key) => localStore.get(key) ?? null,
  setItem: (key, value) => localStore.set(key, String(value)),
}
window.focus = () => {}

const healthFrames = [
  { ok: true, configured: true, auth_source: 'credential:HA_TOKEN', core_state: 'RUNNING', label: '客厅 HA' },
  { ok: false, configured: true, auth_source: 'credential:HA_TOKEN', core_state: 'NOT_RUNNING', label: '客厅 HA', hints: ['API 不可达'] },
  { ok: true, configured: true, auth_source: 'credential:HA_TOKEN', core_state: 'RUNNING', label: '客厅 HA' },
]
let frameIndex = 0
const realFetch = globalThis.fetch
globalThis.fetch = async () => {
  const data = healthFrames[Math.min(frameIndex, healthFrames.length - 1)]
  frameIndex += 1
  return { ok: true, json: async () => data }
}

const notifyCtx = {
  configForms: { get: () => notifyForm },
  slots: {
    inject: (_name, callback) => callback(),
    register: () => () => {},
  },
  effect: (fn) => {
    const cleanup = fn()
    if (typeof cleanup === 'function') notifyCleanups.push(cleanup)
    return cleanup
  },
}
try {
  plugin.apply(notifyCtx)
  await new Promise((resolve) => setTimeout(resolve, 30))
  if (notifications.length !== 0) {
    console.error('FAIL: notifier should baseline without notifying:', notifications)
    process.exit(1)
  }
  document.visibilityState = 'visible'
  notifyListeners.visibilitychange?.()
  await new Promise((resolve) => setTimeout(resolve, 30))
  if (notifications.length !== 1 || notifications[0].title !== 'Home Assistant 不可用') {
    console.error('FAIL: missing down notification:', notifications)
    process.exit(1)
  }
  notifyListeners.visibilitychange?.()
  await new Promise((resolve) => setTimeout(resolve, 30))
  if (notifications.length !== 2 || notifications[1].title !== 'Home Assistant 已恢复') {
    console.error('FAIL: missing recovery notification:', notifications)
    process.exit(1)
  }
} finally {
  for (const cleanup of notifyCleanups.reverse()) cleanup()
  globalThis.fetch = realFetch
  globalThis.document = previousDocument
}

console.log('client harness: PASS')
console.log(`registered settings.section id=${entry.id} order=${entry.order}`)
console.log(`inputs=${out.value.length} texts=${out.text.length}`)
console.log(`notifications=${notifications.map((item) => item.title).join(' -> ')}`)
