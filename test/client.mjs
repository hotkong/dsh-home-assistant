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
  baseUrl: 'http://192.168.0.11:8123',
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

const registered = []
const ctx = {
  configForms: { get: (id) => (id === 'home-assistant' ? form : undefined) },
  slots: {
    inject(name, cb) {
      if (name !== 'settings.section') throw new Error(`unexpected slot ${name}`)
      return cb()
    },
    register(entry, component) {
      registered.push({ entry, component })
      return () => {}
    },
  },
}

plugin.apply(ctx)
if (registered.length !== 1) {
  console.error(`FAIL: expected one settings.section registration, got ${registered.length}`)
  process.exit(1)
}
const { entry, component } = registered[0]
if (entry.id !== 'home-assistant' || typeof entry.label !== 'function' || entry.label() !== 'Home Assistant') {
  console.error('FAIL: unexpected registration', entry)
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
for (const expected of ['Home Assistant', '连接配置', '保存配置', '实例地址 baseUrl']) {
  if (!text.includes(expected)) {
    console.error(`FAIL: rendered page is missing ${JSON.stringify(expected)}:\n${text}`)
    process.exit(1)
  }
}
if (!out.value.includes('http://192.168.0.11:8123') || !out.value.includes('客厅 HA')) {
  console.error('FAIL: configuration inputs were not populated from the form snapshot:', out.value)
  process.exit(1)
}
if (!out.value.includes('/data/dsh/home/homeassistant')) {
  console.error('FAIL: workspace allowlist textarea was not populated:', out.value)
  process.exit(1)
}
if (!out.placeholder.includes('http://192.168.0.11:8123')) {
  console.error('FAIL: baseUrl placeholder missing')
  process.exit(1)
}

console.log('client harness: PASS')
console.log(`registered settings.section id=${entry.id} order=${entry.order}`)
console.log(`inputs=${out.value.length} texts=${out.text.length}`)
