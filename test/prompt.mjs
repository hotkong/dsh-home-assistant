#!/usr/bin/env node
/**
 * Unit harness for the injection gate: global switch + workspace allowlist.
 * No network, no host.
 *
 *   node test/prompt.mjs
 */

import { renderBlock } from '../lib/prompt.js'

const snapshot = {
  ok: true,
  at: Date.now(),
  label: '客厅 HA',
  url: 'http://homeassistant.local:8123',
  notes: '',
  version: { core: '2026.10.4', supervisor: '2026.10.4', os: '18.3.1' },
  core_state: 'RUNNING',
  time_zone: 'Asia/Shanghai',
  recovery_mode: false,
  watchdog: true,
  disk: { used_gb: 13.8, total_gb: 27.7 },
  scale: { entities: 42, devices: 7, areas: 3, integrations: 5 },
  stats: [{ title: '亮灯数', value: '3', ok: true }],
  hints: [],
}

const context = (cwd) => ({ agent: cwd === undefined ? undefined : { session: { header: { cwd } } } })

const cases = [
  {
    name: 'global switch off → empty even with no allowlist',
    config: { inject: { enabled: false, workspaces: [] } },
    ctx: context('/data/dsh/home/homeassistant'),
    expect: '',
  },
  {
    name: 'empty allowlist → every workspace',
    config: { inject: { enabled: true, workspaces: [] } },
    ctx: context('/some/other/workspace'),
    expect: '<home_assistant',
  },
  {
    name: 'allowlist match → block',
    config: { inject: { enabled: true, workspaces: ['/data/dsh/home/homeassistant'] } },
    ctx: context('/data/dsh/home/homeassistant'),
    expect: '<home_assistant',
  },
  {
    name: 'allowlist child path → block',
    config: { inject: { enabled: true, workspaces: ['/data/dsh/home/homeassistant/'] } },
    ctx: context('/data/dsh/home/homeassistant/docs'),
    expect: '<home_assistant',
  },
  {
    name: 'allowlist miss → empty',
    config: { inject: { enabled: true, workspaces: ['/data/dsh/home/homeassistant'] } },
    ctx: context('/data/dsh/home/dsh-home-assistant'),
    expect: '',
  },
  {
    name: 'allowlist + unknown cwd → empty (fail closed)',
    config: { inject: { enabled: true, workspaces: ['/data/dsh/home/homeassistant'] } },
    ctx: context(undefined),
    expect: '',
  },
]

let failed = 0
for (const item of cases) {
  const block = renderBlock(snapshot, item.config, item.ctx)
  const pass = item.expect === '' ? block === '' : block.startsWith(item.expect)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${item.name}`)
  if (!pass) {
    failed += 1
    console.log(`      expected ${JSON.stringify(item.expect)}, got ${JSON.stringify(block.slice(0, 80))}`)
  }
}
process.exit(failed ? 1 : 0)
