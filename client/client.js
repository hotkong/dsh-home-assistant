// dsh-home-assistant — plugin page card: live status + an inline configuration editor.
// Plain React + inline styles on purpose: it must render on any host build without
// depending on a specific primitives API surface.
window.__ModuleLoader__.load({
  id: 'dsh-home-assistant',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const ENTRY_ID = 'home-assistant'
    const ROUTE = '/dsh-home-assistant/status'

    const S = {
      card: { display: 'grid', gap: 12, padding: '14px 16px', fontSize: 13, lineHeight: 1.55 },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      dot: (tone) => ({
        width: 8,
        height: 8,
        borderRadius: 999,
        background: tone === 'ok' ? '#22c55e' : tone === 'warn' ? '#f59e0b' : '#ef4444',
        flex: '0 0 auto',
      }),
      muted: { opacity: 0.65 },
      title: { fontWeight: 600 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, opacity: 0.7 },
      box: { border: '1px solid rgba(127,127,127,.25)', borderRadius: 10, padding: '12px 14px', display: 'grid', gap: 10 },
      label: { display: 'grid', gap: 4, minWidth: 220, flex: '1 1 220px' },
      caption: { fontSize: 11, opacity: 0.65 },
      input: {
        padding: '5px 8px',
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
      },
      primary: {
        padding: '5px 12px',
        borderRadius: 6,
        border: '1px solid #18BCF2',
        background: '#18BCF2',
        color: '#04141d',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 600,
      },
      statRow: { display: 'flex', justifyContent: 'space-between', gap: 12 },
      statGrid: { display: 'grid', gap: 6 },
    }

    function useStatus() {
      const [state, setState] = React.useState({ phase: 'loading', data: null, error: '' })
      const load = React.useCallback(async () => {
        try {
          const response = await fetch(ROUTE, { cache: 'no-store' })
          setState({ phase: 'ready', data: await response.json(), error: '' })
        } catch (error) {
          setState({ phase: 'error', data: null, error: String(error?.message ?? error) })
        }
      }, [])
      React.useEffect(() => {
        let alive = true
        load()
        const timer = setInterval(() => {
          if (alive) load()
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
        tokenRef: value?.tokenRef ?? '',
        token: '',
        stats: stats.map((stat) => ({
          title: stat?.title ?? '',
          entity: stat?.entity ?? '',
          attribute: stat?.attribute ?? '',
          template: stat?.template ?? '',
          unit: stat?.unit ?? '',
        })),
        injectEnabled: value?.inject?.enabled !== false,
        showScale: value?.status?.showScale !== false,
      }
    }

    function Field({ caption, children }) {
      return h('label', { style: S.label }, h('span', { style: S.caption }, caption), children)
    }

    function ConfigEditor({ form, snapshot, onSaved }) {
      const [draft, setDraft] = React.useState(() => draftFrom(snapshot.value))
      const [message, setMessage] = React.useState('')
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
        setMessage('')
        try {
          const ops = [
            { op: 'set', path: ['baseUrl'], value: draft.baseUrl.trim() },
            { op: 'set', path: ['label'], value: draft.label.trim() },
            { op: 'set', path: ['notes'], value: draft.notes.trim() },
            { op: 'set', path: ['tokenRef'], value: draft.tokenRef.trim() },
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
            { op: 'set', path: ['status', 'showScale'], value: draft.showScale },
          ]
          if (draft.token.trim()) ops.push({ op: 'set', path: ['token'], value: draft.token.trim() })
          const ok = await form.mutate(ops, snapshot.revision)
          setMessage(ok ? '已保存，下一轮对话生效' : '保存被拒绝，请刷新后重试')
          if (ok) {
            patch('token', '')
            if (typeof onSaved === 'function') onSaved()
          }
        } catch (error) {
          setMessage(`保存失败：${error?.message ?? error}`)
        } finally {
          setBusy(false)
        }
      }

      if (!form || snapshot.status === 'unavailable') {
        return h(
          'div',
          { style: S.box },
          h('div', { style: S.title }, '配置'),
          h('div', { style: S.muted }, '当前宿主没有暴露这个插件的配置命名空间，请用 profile 的 cordis.patch.yml 修改。'),
        )
      }

      return h(
        'div',
        { style: S.box },
        h(
          'div',
          { style: S.row },
          h('div', { style: S.title }, '配置'),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', style: S.primary, disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
        ),
        h(
          'div',
          { style: S.row },
          h(
            Field,
            { caption: '实例地址 baseUrl' },
            h('input', { style: S.input, value: draft.baseUrl, onChange: (e) => patch('baseUrl', e.target.value), placeholder: 'http://192.168.0.11:8123' }),
          ),
          h(
            Field,
            { caption: '显示名 label' },
            h('input', { style: S.input, value: draft.label, onChange: (e) => patch('label', e.target.value), placeholder: '客厅 HA' }),
          ),
        ),
        h(
          Field,
          { caption: '备注 notes（会进入系统提示词）' },
          h('input', { style: S.input, value: draft.notes, onChange: (e) => patch('notes', e.target.value) }),
        ),
        h(
          'div',
          { style: S.row },
          h(
            Field,
            { caption: '凭据名 tokenRef（推荐）' },
            h('input', { style: S.input, value: draft.tokenRef, onChange: (e) => patch('tokenRef', e.target.value), placeholder: 'HA_TOKEN' }),
          ),
          h(
            Field,
            { caption: '内联令牌 token（留空则不修改，会写入 profile 配置）' },
            h('input', {
              style: S.input,
              type: 'password',
              value: draft.token,
              onChange: (e) => patch('token', e.target.value),
              placeholder: '••••••（已设置就留空）',
            }),
          ),
        ),
        h('div', { style: S.caption }, '观测项（1–6 个，entity 与 template 二选一；模板需要管理员令牌）'),
        draft.stats.map((stat, index) =>
          h(
            'div',
            { key: index, style: S.row },
            h('input', { style: { ...S.input, flex: '0 0 120px' }, value: stat.title, placeholder: '标题', onChange: (e) => patchStat(index, 'title', e.target.value) }),
            h('input', { style: { ...S.input, flex: '1 1 200px' }, value: stat.entity, placeholder: 'entity_id', onChange: (e) => patchStat(index, 'entity', e.target.value) }),
            h('input', {
              style: { ...S.input, flex: '1 1 240px' },
              value: stat.template,
              placeholder: '或 Jinja 模板',
              onChange: (e) => patchStat(index, 'template', e.target.value),
            }),
            h('input', { style: { ...S.input, flex: '0 0 70px' }, value: stat.unit, placeholder: '单位', onChange: (e) => patchStat(index, 'unit', e.target.value) }),
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
        ),
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
          h(
            'label',
            { style: { ...S.row, gap: 6 } },
            h('input', { type: 'checkbox', checked: draft.injectEnabled, onChange: (e) => patch('injectEnabled', e.target.checked) }),
            h('span', { style: S.caption }, '注入系统提示词'),
          ),
          h(
            'label',
            { style: { ...S.row, gap: 6 } },
            h('input', { type: 'checkbox', checked: draft.showScale, onChange: (e) => patch('showScale', e.target.checked) }),
            h('span', { style: S.caption }, '统计实体/设备/区域数量'),
          ),
        ),
        message ? h('div', { style: S.caption }, message) : null,
      )
    }

    function StatusBlock({ state, reload, data }) {
      return h(
        React.Fragment,
        null,
        h(
          'div',
          { style: S.row },
          h('span', { style: S.dot(state.phase !== 'ready' ? 'err' : data?.ok ? 'ok' : 'warn') }),
          h('span', { style: S.title }, data?.label || 'Home Assistant'),
          h('span', { style: S.muted }, data?.url || ''),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', style: S.button, onClick: reload }, '刷新状态'),
        ),
        state.phase === 'error' ? h('div', { style: S.muted }, `读取状态失败：${state.error}`) : null,
        data?.pending ? h('div', { style: S.muted }, '正在首次探测…') : null,
        data && !data.pending && !data.ok
          ? h('div', null, (data.hints || []).map((hint, index) => h('div', { key: index, style: S.muted }, `· ${hint}`)))
          : null,
        data?.ok
          ? h(
              'div',
              { style: S.statGrid },
              h(
                'div',
                { style: S.muted },
                [
                  data.version?.core && `Core ${data.version.core}`,
                  data.version?.supervisor && `Supervisor ${data.version.supervisor}`,
                  data.version?.os && `OS ${data.version.os}`,
                ]
                  .filter(Boolean)
                  .join(' ｜ '),
              ),
              h(
                'div',
                null,
                `状态：${data.core_state || '未知'}${data.recovery_mode ? '（recovery_mode）' : ''}${data.watchdog === false ? '（watchdog 关闭）' : ''}`,
              ),
              h(
                'div',
                { style: S.muted },
                [
                  typeof data.scale?.entities === 'number' && `${data.scale.entities} 实体`,
                  typeof data.scale?.devices === 'number' && `${data.scale.devices} 设备`,
                  typeof data.scale?.areas === 'number' && `${data.scale.areas} 区域`,
                  typeof data.scale?.integrations === 'number' && `${data.scale.integrations} 集成`,
                ]
                  .filter(Boolean)
                  .join(' / '),
              ),
              (data.stats || []).length
                ? h(
                    'div',
                    { style: S.statGrid },
                    data.stats.map((stat, index) =>
                      h('div', { key: index, style: S.statRow }, h('span', { style: S.muted }, stat.title), h('span', null, stat.value ?? '—')),
                    ),
                  )
                : null,
            )
          : null,
        h('div', { style: S.mono }, data?.updated_at ? `更新：${data.updated_at}` : ''),
      )
    }

    function Card({ form }) {
      const [state, reload] = useStatus()
      const snapshot = useSnapshot(form)
      return h('div', { style: S.card }, h(StatusBlock, { state, reload, data: state.data }), h(ConfigEditor, { form, snapshot, onSaved: reload }))
    }

    return {
      name: 'home-assistant',
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.slots ?? (typeof ctx.get === 'function' ? ctx.get('slots') : undefined)
        if (!slots || typeof slots.inject !== 'function') {
          console.warn('[dsh-home-assistant] slots 服务不可用，状态卡未注册')
          return
        }
        const configForms = ctx.configForms ?? (typeof ctx.get === 'function' ? ctx.get('configForms') : undefined)
        const form = configForms && typeof configForms.get === 'function' ? configForms.get(ENTRY_ID) : null
        const Bound = () => h(Card, { form })
        slots.inject('plugins.detail.section', () => slots.register({ name: 'plugins.detail.section', key: ENTRY_ID, id: ENTRY_ID, order: 10 }, Bound))
        slots.inject('settings.plugin.item', () =>
          slots.register({ name: 'settings.plugin.item', key: ENTRY_ID, id: ENTRY_ID, order: 10, locale: ENTRY_ID }, Bound),
        )
        // Older/portable settings UI: a dedicated page, registered the same way
        // dsh-chat-manager does on this host.
        slots.inject('settings.section', () =>
          slots.register({ name: 'settings.section', id: ENTRY_ID, order: 40, priority: -10, label: () => 'Home Assistant' }, Bound),
        )
      },
    }
  },
})
