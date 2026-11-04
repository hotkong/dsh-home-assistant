#!/usr/bin/env node
/**
 * Offline harness: mount the plugin against a fake cordis context and print what
 * the model would see. Run with a real instance:
 *
 *   HA_TOKEN=... node test/run.mjs [baseUrl]
 *
 * The token is read from the environment through the credential reference path,
 * so this also exercises token resolution.
 */

import { apply, Config } from '../lib/index.js'

const baseUrl = process.argv[2] || process.env.HA_BASE_URL || 'http://homeassistant.local:8123'

const config = new Config({
  baseUrl,
  label: '客厅 HA',
  notes: '重启约 4.5–5 分钟；YAML 配置文件无 API',
  stats: [
    { title: '实体总数', entity: 'sun.sun' },
    { title: '亮灯数', template: "{{ states.light | selectattr('state','eq','on') | list | count }}" },
  ],
})

const registered = { tools: [], sections: [], routes: [] }

const scoped = {
  systemPrompt: {
    section(section) {
      registered.sections.push(section)
      return () => {}
    },
  },
  webServer: {
    register(route) {
      registered.routes.push(route)
      return () => {}
    },
  },
  effect(fn) {
    fn()
  },
  logger: console,
}

const ctx = {
  logger: console,
  get(name) {
    return name === 'credentials' ? { resolve: async () => undefined } : undefined
  },
  tools: {
    register(definition) {
      registered.tools.push(definition)
      return () => {}
    },
  },
  inject(names, callback) {
    callback(scoped)
  },
  effect(fn) {
    fn()
  },
}

apply(ctx, config)

const tool = registered.tools.find((item) => item.name === 'ha_status')
if (!tool) {
  console.error('FAIL: ha_status was not registered')
  process.exit(1)
}

const value = await tool.execute({ refresh: true })
const text = tool.output.render({}, value).map((block) => block.text).join('\n')

console.log('=== ha_status（模型看到的文本）===')
console.log(text)
console.log('\n=== 结果体积 ===')
console.log(`${Buffer.byteLength(JSON.stringify(value))} bytes`)

const section = registered.sections[0]
const block = section ? section.text({}) : ''
console.log('\n=== 系统提示词注入块 ===')
console.log(block)
console.log(`\n字符数：${block.length}（上限按配置 maxChars=600）`)
console.log(`interpolate: ${section?.interpolate}；order: ${section?.order}`)

const budgetOk = Buffer.byteLength(JSON.stringify(value)) <= 4096
console.log(`\n预算检查（≤4096 bytes）：${budgetOk ? 'PASS' : 'FAIL'}`)
process.exit(budgetOk ? 0 : 1)
