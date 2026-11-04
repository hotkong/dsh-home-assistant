// dsh-home-assistant — Settings section: live status + configuration editor.
// One `settings.section` registration: the host's settings shell lists every
// entry as a nav row (see dsh-client-ui-settings-general) and renders the page
// body with the composed props. Plain React + inline styles on purpose: no
// primitives-version coupling, no build step.
window.__ModuleLoader__.load({
  id: 'dsh-home-assistant',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const ENTRY_ID = 'home-assistant'
    const ROUTE = '/dsh-home-assistant/status'

    const S = {
      page: { display: 'grid', gap: 16, padding: '4px 2px 24px', fontSize: 13, lineHeight: 1.55 },
      card: { display: 'grid', gap: 12, padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(127,127,127,.22)' },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      dot: (tone) => ({
        width: 9,
        height: 9,
        borderRadius: 999,
        background: tone === 'ok' ? '#22c55e' : tone === 'warn' ? '#f59e0b' : '#ef4444',
        flex: '0 0 auto',
        boxShadow: tone === 'ok' ? '0 0 0 3px rgba(34,197,94,.15)' : 'none',
      }),
      muted: { opacity: 0.65 },
      title: { fontWeight: 600, fontSize: 14 },
      sectionTitle: { fontWeight: 600, fontSize: 13, marginBottom: 2 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, opacity: 0.7 },
      grid: { display: 'grid', gap: 6 },
      kv: { display: 'grid', gridTemplateColumns: '96px 1fr', gap: 8, alignItems: 'baseline' },
      key: { opacity: 0.6, fontSize: 12 },
      label: { display: 'grid', gap: 4, minWidth: 210, flex: '1 1 210px' },
      caption: { fontSize: 11, opacity: 0.65 },
      input: {
        padding: '6px 8px',
        borderRadius: 6,
        border: '1px solid rgba(127,127,127,.4)',
        background: 'transparent',
        color: 'inherit',
        fontSize: 12,
        width: '100%',
        boxSizing: 'border-box',
      },
      button: {
        padding: '5px 12px',
        borderRadius: 6,
        border: '1px solid rgba(127,127,127,.4)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12,
        textDecoration: 'none',
      },
      primary: {
        padding: '5px 14px',
        borderRadius: 6,
        border: '1px solid #18BCF2',
        background: '#18BCF2',
        color: '#04141d',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 600,
      },
      badge: {
        padding: '1px 7px',
        borderRadius: 999,
        border: '1px solid rgba(127,127,127,.35)',
        fontSize: 11,
        opacity: 0.8,
      },
      statRow: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 0' },
      divider: { borderTop: '1px solid rgba(127,127,127,.18)', margin: '2px 0' },
      subsection: { display: 'grid', gap: 8, paddingTop: 2 },
      tokenBox: { display: 'grid', gap: 8, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(127,127,127,.22)', background: 'rgba(127,127,127,.04)' },
      hint: { color: '#f59e0b' },
      error: { color: '#ef4444' },
      ok: { color: '#22c55e' },
    }

    function useStatus() {
      const [state, setState] = React.useState({ phase: 'loading', data: null, error: '' })
      const load = React.useCallback(async (force) => {
        try {
          const response = await fetch(force ? `${ROUTE}?refresh=1` : ROUTE, { cache: 'no-store' })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setState({ phase: 'ready', data: await response.json(), error: '' })
        } catch (error) {
          setState({ phase: 'error', data: null, error: String(error?.message ?? error) })
        }
      }, [])
      React.useEffect(() => {
        let alive = true
        load(false)
        const timer = setInterval(() => {
          if (alive) load(false)
        }, 15000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [load])
      return [state, load]
    }

    function useSnapshot(form) {
      const subscribe = React.useCallback((cb) => (form ? form.subscribe(cb) : () => {}), [form])
      const get = React.useCallback(() => (form ? form.getSnapshot() : { status: 'unavailable' }), [form])
      return React.useSyncExternalStore(subscribe, get, get)
    }

    const emptyStat = () => ({ title: '', entity: '', attribute: '', template: '', unit: '' })

    function draftFrom(value) {
      const stats = Array.isArray(value?.stats) ? value.stats : []
      return {
        baseUrl: value?.baseUrl ?? '',
        label: value?.label ?? '',
        notes: value?.notes ?? '',
        stats: stats.map((stat) => ({
          title: stat?.title ?? '',
          entity: stat?.entity ?? '',
          attribute: stat?.attribute ?? '',
          template: stat?.template ?? '',
          unit: stat?.unit ?? '',
        })),
        injectEnabled: value?.inject?.enabled !== false,
        workspaces: Array.isArray(value?.inject?.workspaces) ? value.inject.workspaces.join('\n') : '',
        showScale: value?.status?.showScale !== false,
      }
    }

    function Field({ caption, children }) {
      return h('label', { style: S.label }, h('span', { style: S.caption }, caption), children)
    }

    const TOKEN_ROUTE = '/dsh-home-assistant/token'

    async function readJson(response) {
      try {
        return await response.json()
      } catch {
        return {}
      }
    }

    /**
     * One token field. The server half owns the credential-store write; the
     * browser only talks to this plugin's same-origin route, so a missing
     * credentials client service can never fail the client boot.
     */
    function TokenEditor({ authSource, onChanged }) {
      const [value, setValue] = React.useState('')
      const [info, setInfo] = React.useState({ phase: 'loading', configured: false, writable: false, message: '' })
      const [busy, setBusy] = React.useState(false)

      const refresh = React.useCallback(async () => {
        try {
          const response = await fetch(TOKEN_ROUTE, { cache: 'no-store' })
          const body = await readJson(response)
          if (!response.ok || body.ok === false) throw new Error(body.error ?? `HTTP ${response.status}`)
          setInfo((current) => ({
            phase: 'ready',
            configured: body.configured === true,
            writable: body.writable !== false,
            message: current.message,
          }))
        } catch (error) {
          setInfo((current) => ({ ...current, phase: 'error', message: `读取凭据失败：${error?.message ?? error}` }))
        }
      }, [])

      React.useEffect(() => {
        refresh()
      }, [refresh])

      async function save() {
        const token = value.trim()
        if (!token) return
        setBusy(true)
        try {
          const response = await fetch(TOKEN_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token }),
          })
          const body = await readJson(response)
          if (!response.ok || body.ok === false) throw new Error(body.error ?? `HTTP ${response.status}`)
          setValue('')
          setInfo((current) => ({ ...current, phase: 'ready', configured: true, message: '已保存到凭据库' }))
          if (typeof onChanged === 'function') onChanged()
          refresh()
        } catch (error) {
          setInfo((current) => ({ ...current, message: `保存失败：${error?.message ?? error}` }))
        } finally {
          setBusy(false)
        }
      }

      async function clear() {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('清除已保存的访问令牌？')) return
        setBusy(true)
        try {
          const response = await fetch(TOKEN_ROUTE, { method: 'DELETE' })
          const body = await readJson(response)
          if (!response.ok || body.ok === false) throw new Error(body.error ?? `HTTP ${response.status}`)
          setInfo((current) => ({ ...current, phase: 'ready', configured: false, message: '已清除' }))
          if (typeof onChanged === 'function') onChanged()
          refresh()
        } catch (error) {
          setInfo((current) => ({ ...current, message: `清除失败：${error?.message ?? error}` }))
        } finally {
          setBusy(false)
        }
      }

      const configured = info.configured
      const statusText =
        authSource === 'inline'
          ? '当前使用 profile 里的内联令牌（高级配置），它会覆盖凭据库。'
          : typeof authSource === 'string' && authSource.startsWith('env:')
            ? '当前使用环境变量里的令牌；凭据库中的令牌会优先。'
            : authSource && authSource !== 'none'
              ? '令牌已配置，插件会自动读取。'
              : configured
                ? '令牌已保存，等待下一次状态探测。'
                : '还没有保存令牌。'
      const warn = authSource === 'inline' || (!configured && authSource === 'none')
      return h(
        'div',
        { style: S.tokenBox },
        h(
          'div',
          { style: S.row },
          h('span', { style: S.sectionTitle }, '访问令牌'),
          h('span', { style: { ...S.badge, ...(configured ? {} : S.hint) } }, configured ? '已保存' : '未保存'),
          h('span', { style: { flex: 1 } }),
          configured ? h('button', { type: 'button', style: S.button, disabled: busy, onClick: clear }, '清除') : null,
        ),
        h('div', { style: S.caption }, '长期访问令牌保存在 DSH 凭据库，不会写进 profile 配置。'),
        h(
          'div',
          { style: S.row },
          h('input', {
            style: { ...S.input, flex: '1 1 260px' },
            type: 'password',
            autoComplete: 'new-password',
            value,
            onChange: (e) => setValue(e.target.value),
            placeholder: configured ? '••••••（重新填写以替换）' : '粘贴 HA 长期访问令牌',
          }),
          h('button', { type: 'button', style: S.primary, disabled: busy || !value.trim(), onClick: save }, busy ? '保存中…' : '保存令牌'),
        ),
        h(
          'div',
          { style: warn ? { ...S.caption, ...S.hint } : S.caption },
          `${statusText}${info.message ? ` · ${info.message}` : ''}`,
        ),
      )
    }

    function ConfigEditor({ form, snapshot, onSaved, authSource }) {
      const [draft, setDraft] = React.useState(() => draftFrom(snapshot.value))
      const [message, setMessage] = React.useState({ tone: 'muted', text: '' })
      const [busy, setBusy] = React.useState(false)
      const initialised = React.useRef(false)

      React.useEffect(() => {
        if (!initialised.current && snapshot.status === 'ready') {
          setDraft(draftFrom(snapshot.value))
          initialised.current = true
        }
      }, [snapshot])

      const patch = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
      const patchStat = (index, key, value) =>
        setDraft((current) => ({
          ...current,
          stats: current.stats.map((stat, position) => (position === index ? { ...stat, [key]: value } : stat)),
        }))

      async function save() {
        if (!form) return
        setBusy(true)
        setMessage({ tone: 'muted', text: '' })
        try {
          const ops = [
            { op: 'set', path: ['baseUrl'], value: draft.baseUrl.trim() },
            { op: 'set', path: ['label'], value: draft.label.trim() },
            { op: 'set', path: ['notes'], value: draft.notes.trim() },
            {
              op: 'set',
              path: ['stats'],
              value: draft.stats
                .filter((stat) => stat.title.trim() || stat.entity.trim() || stat.template.trim())
                .map((stat) => ({
                  title: stat.title.trim() || '未命名',
                  entity: stat.entity.trim(),
                  attribute: stat.attribute.trim(),
                  template: stat.template.trim(),
                  unit: stat.unit,
                })),
            },
            { op: 'set', path: ['inject', 'enabled'], value: draft.injectEnabled },
            {
              op: 'set',
              path: ['inject', 'workspaces'],
              value: draft.workspaces
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            },
            { op: 'set', path: ['status', 'showScale'], value: draft.showScale },
          ]
          const ok = await form.mutate(ops, snapshot.revision)
          if (ok) {
            setMessage({ tone: 'ok', text: '已保存，系统提示词与状态卡将在下一轮刷新时更新' })
            if (typeof onSaved === 'function') onSaved()
          } else {
            setMessage({ tone: 'error', text: '保存被拒绝（配置可能在别处被修改），请刷新页面后重试' })
          }
        } catch (error) {
          setMessage({ tone: 'error', text: `保存失败：${error?.message ?? error}` })
        } finally {
          setBusy(false)
        }
      }

      if (!form || snapshot.status === 'unavailable') {
        return h(
          'div',
          { style: S.card },
          h('div', { style: S.sectionTitle }, '连接配置'),
          h(
            'div',
            { style: S.muted },
            '当前宿主没有提供这个插件条目的配置命名空间（通常是 Config schema 未加载成功）。可以直接编辑 profile 的 cordis.patch.yml 后用 `dsh` 重启。',
          ),
        )
      }

      return h(
        'div',
        { style: S.card },
        h(
          'div',
          { style: S.row },
          h('div', { style: S.sectionTitle }, '配置'),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', style: S.primary, disabled: busy, onClick: save }, busy ? '保存中…' : '保存配置'),
        ),
        h(
          Field,
          { caption: '实例地址 baseUrl（含端口）' },
          h('input', {
            style: S.input,
            value: draft.baseUrl,
            onChange: (e) => patch('baseUrl', e.target.value),
            placeholder: 'http://192.168.0.11:8123',
            spellCheck: false,
          }),
        ),
        h(TokenEditor, { authSource, onChanged: onSaved }),
        h('div', { style: S.divider }),
        h(
          'div',
          { style: S.subsection },
          h('div', { style: S.sectionTitle }, '观测项'),
          h('div', { style: S.caption }, '最多 6 个；entity 与 template 二选一，template 需要管理员令牌'),
        ),
        draft.stats.length
          ? draft.stats.map((stat, index) =>
              h(
                'div',
                { key: index, style: S.row },
                h('input', {
                  style: { ...S.input, flex: '0 0 100px' },
                  value: stat.title,
                  placeholder: '标题',
                  onChange: (e) => patchStat(index, 'title', e.target.value),
                }),
                h('input', {
                  style: { ...S.input, flex: '1 1 190px' },
                  value: stat.entity,
                  placeholder: 'sensor.xxx（entity）',
                  onChange: (e) => patchStat(index, 'entity', e.target.value),
                  spellCheck: false,
                }),
                h('input', {
                  style: { ...S.input, flex: '1 1 220px' },
                  value: stat.template,
                  placeholder: '或 Jinja 模板',
                  onChange: (e) => patchStat(index, 'template', e.target.value),
                  spellCheck: false,
                }),
                h('input', {
                  style: { ...S.input, flex: '0 0 60px' },
                  value: stat.unit,
                  placeholder: '单位',
                  onChange: (e) => patchStat(index, 'unit', e.target.value),
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    style: S.button,
                    onClick: () => setDraft((current) => ({ ...current, stats: current.stats.filter((_, p) => p !== index) })),
                  },
                  '删除',
                ),
              ),
            )
          : h('div', { style: S.muted }, '还没有观测项。'),
        h(
          'div',
          { style: S.row },
          h(
            'button',
            {
              type: 'button',
              style: S.button,
              disabled: draft.stats.length >= 6,
              onClick: () => setDraft((current) => ({ ...current, stats: [...current.stats, emptyStat()] })),
            },
            '+ 添加观测项',
          ),
          h('span', { style: S.caption }, `${draft.stats.length} / 6`),
        ),
        h('div', { style: S.divider }),
        h(
          'div',
          { style: S.subsection },
          h('div', { style: S.sectionTitle }, '显示与系统提示词注入'),
          h(
            'label',
            { style: { ...S.row, gap: 8 } },
            h('input', {
              type: 'checkbox',
              checked: draft.injectEnabled,
              onChange: (e) => patch('injectEnabled', e.target.checked),
            }),
            h('span', null, '在每个请求的系统提示词里带上 <home_assistant> 环境块'),
          ),
          h(
            'div',
            { style: S.caption },
            draft.injectEnabled
              ? '关闭后所有对话都不再自动注入；ha_status 工具仍然可用。'
              : '当前已关闭：不会自动注入，仍可随时调用 ha_status。',
          ),
          h(
            Field,
            { caption: '显示名 label（状态卡标题 + 注入块）' },
            h('input', {
              style: S.input,
              value: draft.label,
              onChange: (e) => patch('label', e.target.value),
              placeholder: '客厅 HA',
            }),
          ),
          h(
            Field,
            { caption: '备注 notes（只写入注入块；关闭注入后不生效）' },
            h('textarea', {
              style: {
                ...S.input,
                minHeight: 44,
                resize: 'vertical',
                opacity: draft.injectEnabled ? 1 : 0.5,
              },
              value: draft.notes,
              onChange: (e) => patch('notes', e.target.value),
              placeholder: '例如：重启约 4.5–5 分钟；YAML 配置文件无 API',
            }),
          ),
          h(
            Field,
            { caption: '仅在以下工作区自动注入（每行一个绝对路径；留空 = 所有工作区）' },
            h('textarea', {
              style: {
                ...S.input,
                minHeight: 54,
                resize: 'vertical',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                opacity: draft.injectEnabled ? 1 : 0.5,
              },
              value: draft.workspaces,
              onChange: (e) => patch('workspaces', e.target.value),
              placeholder: '/data/dsh/home/homeassistant',
              spellCheck: false,
            }),
          ),
        ),
        h('div', { style: S.divider }),
        h(
          'div',
          { style: S.subsection },
          h('div', { style: S.sectionTitle }, '状态探测'),
          h(
            'label',
            { style: { ...S.row, gap: 8 } },
            h('input', {
              type: 'checkbox',
              checked: draft.showScale,
              onChange: (e) => patch('showScale', e.target.checked),
            }),
            h('span', null, '统计实体 / 设备 / 区域 / 集成数量'),
          ),
        ),
        message.text ? h('div', { style: message.tone === 'error' ? S.error : message.tone === 'ok' ? S.ok : S.muted }, message.text) : null,
      )
    }

    function KV({ label, children }) {
      return h('div', { style: S.kv }, h('span', { style: S.key }, label), h('span', null, children))
    }

    function StatusBlock({ state, reload, data }) {
      const tone = state.phase !== 'ready' ? 'err' : data?.ok ? 'ok' : 'warn'
      const versions = [
        data?.version?.core && `Core ${data.version.core}`,
        data?.version?.supervisor && `Supervisor ${data.version.supervisor}`,
        data?.version?.os && `OS ${data.version.os}`,
      ]
        .filter(Boolean)
        .join(' ｜ ')
      const scale = [
        typeof data?.scale?.entities === 'number' && `${data.scale.entities} 实体`,
        typeof data?.scale?.devices === 'number' && `${data.scale.devices} 设备`,
        typeof data?.scale?.areas === 'number' && `${data.scale.areas} 区域`,
        typeof data?.scale?.integrations === 'number' && `${data.scale.integrations} 集成`,
      ]
        .filter(Boolean)
        .join(' / ')

      return h(
        'div',
        { style: S.card },
        h(
          'div',
          { style: S.row },
          h('span', { style: S.dot(tone) }),
          h('span', { style: S.title }, data?.label || 'Home Assistant'),
          h('span', { style: S.muted }, data?.url || '未配置地址'),
          data?.auth_source && data.auth_source !== 'none'
            ? h('span', { style: S.badge }, '令牌已配置')
            : h('span', { style: { ...S.badge, ...S.hint } }, '未找到令牌'),
          h('span', { style: { flex: 1 } }),
          data?.url ? h('a', { style: S.button, href: data.url, target: '_blank', rel: 'noreferrer' }, '打开 HA') : null,
          h('button', { type: 'button', style: S.button, onClick: () => reload(true) }, '刷新状态'),
        ),

        state.phase === 'error' ? h('div', { style: S.error }, `读取状态失败：${state.error}`) : null,
        data?.pending ? h('div', { style: S.muted }, '正在首次探测 Home Assistant…') : null,

        data && !data.pending && !data.ok
          ? h(
              'div',
              { style: S.grid },
              data.configured === false
                ? h('div', { style: S.hint }, '还没有配置实例地址：在下面的表单里填 baseUrl 并保存，然后点「刷新状态」。')
                : null,
              (data.hints || []).map((hint, index) => h('div', { key: index, style: S.hint }, `· ${hint}`)),
            )
          : null,

        data?.ok
          ? h(
              'div',
              { style: S.grid },
              versions ? h(KV, { label: '版本' }, versions) : null,
              h(
                KV,
                { label: '运行状态' },
                `${data.core_state || '未知'}${data.recovery_mode ? '（recovery_mode）' : ''}${data.watchdog === false ? '（watchdog 关闭）' : ''}`,
              ),
              scale ? h(KV, { label: '规模' }, scale) : null,
              data.disk?.total_gb ? h(KV, { label: '磁盘' }, `已用 ${data.disk.used_gb} / ${data.disk.total_gb} GB`) : null,
              data.time_zone ? h(KV, { label: '时区' }, data.time_zone) : null,
              data.workspace ? h(KV, { label: '注入工作区' }, data.workspace) : null,
              (data.stats || []).length
                ? h(
                    'div',
                    { style: { ...S.grid, marginTop: 4 } },
                    h('div', { style: S.caption }, '观测项'),
                    data.stats.map((stat, index) =>
                      h('div', { key: index, style: S.statRow }, h('span', { style: S.muted }, stat.title), h('span', null, stat.value ?? '—')),
                    ),
                  )
                : null,
            )
          : null,

        h(
          'div',
          { style: S.mono },
          data?.updated_at ? `更新：${data.updated_at}${typeof data.duration_ms === 'number' ? ` · 探测 ${data.duration_ms} ms` : ''}` : '',
        ),
      )
    }

    function Page({ form }) {
      const [state, reload] = useStatus()
      const snapshot = useSnapshot(form)
      return h(
        'div',
        { style: S.page },
        h(StatusBlock, { state, reload, data: state.data }),
        h(ConfigEditor, {
          form,
          snapshot,
          onSaved: () => reload(true),
          authSource: state.data?.auth_source,
        }),
        h(
          'div',
          { style: S.caption },
          '提示：配置保存在 profile 层，所有 workspace 共享；令牌存在 DSH 凭据库，不会出现在日志、提示词或这张卡片里。',
        ),
      )
    }

    return {
      name: 'home-assistant',
      inject: ['slots', 'configForms'],
      apply(ctx) {
        // Never let the settings page take the whole client boot down. The token
        // editor talks to this plugin's own same-origin route, so it does not
        // depend on any optional browser service.
        try {
          const form = ctx.configForms.get(ENTRY_ID)
          const Bound = () => h(Page, { form })
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: ENTRY_ID,
                order: 40,
                label: () => 'Home Assistant',
              },
              Bound,
            ),
          )
        } catch (error) {
          console.warn('[dsh-home-assistant] 设置页未注册（插件其余部分不受影响）：', error)
        }
      },
    }
  },
})
