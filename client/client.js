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
        notifyEnabled: value?.notify?.enabled === true,
        notifyOnDown: value?.notify?.onDown !== false,
        notifyOnRecover: value?.notify?.onRecover !== false,
        notifyFailureThreshold: Number(value?.notify?.failureThreshold ?? 2),
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
            { op: 'set', path: ['notify', 'enabled'], value: draft.notifyEnabled === true },
            { op: 'set', path: ['notify', 'onDown'], value: draft.notifyOnDown !== false },
            { op: 'set', path: ['notify', 'onRecover'], value: draft.notifyOnRecover !== false },
            {
              op: 'set',
              path: ['notify', 'failureThreshold'],
              value: Math.max(1, Number(draft.notifyFailureThreshold) || 2),
            },
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
            placeholder: 'http://homeassistant.local:8123',
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
          h('div', { style: S.sectionTitle }, '浏览器通知'),
          h(
            'label',
            { style: { ...S.row, gap: 8 } },
            h('input', {
              type: 'checkbox',
              checked: draft.notifyEnabled,
              onChange: (e) => patch('notifyEnabled', e.target.checked),
            }),
            h('span', null, '启用通知'),
          ),
          h(
            'div',
            { style: S.caption },
            draft.notifyEnabled
              ? '启用后仍需在上方授权浏览器通知。'
              : '当前关闭；不会自动申请通知权限。',
          ),
          h(NotificationControls),
          h(
            'div',
            { style: { ...S.row, gap: 14, marginTop: 2 } },
            h(
              'label',
              { style: { ...S.row, gap: 6 } },
              h('input', {
                type: 'checkbox',
                checked: draft.notifyOnDown,
                onChange: (e) => patch('notifyOnDown', e.target.checked),
              }),
              h('span', null, '不可用时通知'),
            ),
            h(
              'label',
              { style: { ...S.row, gap: 6 } },
              h('input', {
                type: 'checkbox',
                checked: draft.notifyOnRecover,
                onChange: (e) => patch('notifyOnRecover', e.target.checked),
              }),
              h('span', null, '恢复时通知'),
            ),
          ),
          h(
            Field,
            { caption: '连续失败次数（默认 2，过滤网络抖动）' },
            h('input', {
              style: { ...S.input, width: 96 },
              type: 'number',
              min: 1,
              max: 10,
              value: draft.notifyFailureThreshold,
              onChange: (e) => patch('notifyFailureThreshold', e.target.value),
            }),
          ),
          h(
            'div',
            { style: S.caption },
            '通知需要 DSH 页面保持打开。',
          ),
        ),
        message.text ? h('div', { style: message.tone === 'error' ? S.error : message.tone === 'ok' ? S.ok : S.muted }, message.text) : null,
      )
    }

    function NotificationControls() {
      const supported = typeof window !== 'undefined' && typeof window.Notification === 'function'
      const [permission, setPermission] = React.useState(() => (supported ? window.Notification.permission : 'unsupported'))
      const [message, setMessage] = React.useState('')

      async function enable() {
        if (!supported) {
          setMessage('当前浏览器不支持系统通知。')
          return
        }
        try {
          const result = await window.Notification.requestPermission()
          setPermission(result)
          setMessage(
            result === 'granted'
              ? '已允许；保存配置后，状态变化会发通知。'
              : result === 'denied'
                ? '已被浏览器阻止；请在站点设置里允许通知。'
                : '尚未允许。',
          )
        } catch (error) {
          setMessage(`申请权限失败：${error?.message ?? error}`)
        }
      }

      function test() {
        if (!supported || permission !== 'granted') {
          setMessage('请先允许通知权限。')
          return
        }
        try {
          const now = new Date()
          new window.Notification('Home Assistant 测试通知', {
            body: `如果你看到这条系统通知，说明浏览器通知已可用。测试时间 ${now.toLocaleTimeString()}`,
            tag: `dsh-home-assistant-test-${now.getTime()}`,
          })
          setMessage('已发送测试通知。')
        } catch (error) {
          setMessage(`发送失败：${error?.message ?? error}`)
        }
      }

      const label =
        permission === 'granted'
          ? '已允许'
          : permission === 'denied'
            ? '已阻止'
            : permission === 'unsupported'
              ? '不支持'
              : '未申请'

      return h(
        'div',
        { style: S.tokenBox },
        h(
          'div',
          { style: S.row },
          h(
            'button',
            { type: 'button', style: S.button, disabled: !supported, onClick: enable },
            permission === 'granted' ? '重新申请权限' : '启用浏览器通知',
          ),
          h(
            'button',
            { type: 'button', style: S.button, disabled: permission !== 'granted', onClick: test },
            '发送测试通知',
          ),
          h('span', { style: S.caption }, `权限：${label}`),
        ),
        message ? h('div', { style: S.caption }, message) : null,
        h('div', { style: S.caption }, '通知权限必须由用户点击申请；不会在页面加载时自动弹窗。'),
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

    const SIDEBAR_TAB_ID = 'dsh-home-assistant'
    const MAIN_PANEL_ID = 'home-assistant'
    let statusNotifierCleanup = null

    const SB = {
      panel: { display: 'grid', gap: 10, padding: '10px 12px 16px', fontSize: 12, lineHeight: 1.5 },
      head: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
      name: { fontWeight: 600, fontSize: 13 },
      dot: (tone) => ({
        width: 8,
        height: 8,
        borderRadius: 999,
        flex: '0 0 auto',
        background: tone === 'ok' ? '#22c55e' : tone === 'warn' ? '#f59e0b' : '#ef4444',
      }),
      muted: { opacity: 0.65 },
      grid: { display: 'grid', gap: 4 },
      row: { display: 'flex', justifyContent: 'space-between', gap: 10 },
      button: {
        padding: '3px 9px',
        borderRadius: 6,
        border: '1px solid rgba(127,127,127,.35)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 11,
      },
      link: { fontSize: 11, opacity: 0.7, color: 'inherit' },
      footnote: { fontSize: 10, opacity: 0.5 },
      hint: { color: '#f59e0b', fontSize: 11 },
      error: { color: '#ef4444', fontSize: 11 },
    }

    function HaIcon({ size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3V10.5Z',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinejoin: 'round',
        }),
      )
    }

    /** Compact status source; 30 s matches the server cache and pauses when the tab is hidden. */
    function useSidebarStatus() {
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
        const tick = () => {
          if (!alive) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          load(false)
        }
        tick()
        const timer = setInterval(tick, 30000)
        const onVisibility = () => {
          if (alive && document.visibilityState === 'visible') load(false)
        }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
        return () => {
          alive = false
          clearInterval(timer)
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [load])
      return [state, load]
    }

    function SidebarTitle() {
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } }, h(HaIcon, { size: 14 }), 'Home Assistant')
    }

    function SidebarPanel() {
      const [state, reload] = useSidebarStatus()
      const data = state.data
      const tone = state.phase !== 'ready' ? 'err' : data?.ok ? 'ok' : 'warn'
      const versions = [
        data?.version?.core && `Core ${data.version.core}`,
        data?.version?.supervisor && `Supervisor ${data.version.supervisor}`,
      ]
        .filter(Boolean)
        .join(' · ')
      const stats = Array.isArray(data?.stats) ? data.stats.slice(0, 3) : []
      const scale = data?.scale?.entities

      return h(
        'div',
        { style: SB.panel },
        h(
          'div',
          { style: SB.head },
          h('span', { style: SB.dot(tone) }),
          h('span', { style: SB.name }, data?.label || 'Home Assistant'),
          data?.url ? h('a', { style: SB.link, href: data.url, target: '_blank', rel: 'noreferrer' }, '打开') : null,
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', style: SB.button, onClick: () => reload(true) }, '刷新'),
        ),

        state.phase === 'error' ? h('div', { style: SB.error }, `读取失败：${state.error}`) : null,
        data?.pending ? h('div', { style: SB.muted }, '正在首次探测…') : null,

        data && !data.pending && !data.ok
          ? h(
              'div',
              { style: SB.grid },
              data.configured === false ? h('div', { style: SB.hint }, '还没有配置实例地址。') : null,
              (data.hints || []).slice(0, 2).map((hint, index) => h('div', { key: index, style: SB.hint }, `· ${hint}`)),
            )
          : null,

        data?.ok
          ? h(
              'div',
              { style: SB.grid },
              versions ? h('div', { style: SB.muted }, versions) : null,
              h('div', null, `${data.core_state || '未知'}${data.recovery_mode ? ' · recovery_mode' : ''}${data.watchdog === false ? ' · watchdog 关闭' : ''}`),
              scale ? h('div', { style: SB.muted }, `${scale} 实体${data.scale?.devices ? ` · ${data.scale.devices} 设备` : ''}`) : null,
              stats.length
                ? h(
                    'div',
                    { style: { ...SB.grid, marginTop: 2 } },
                    stats.map((stat, index) =>
                      h('div', { key: index, style: SB.row }, h('span', { style: SB.muted }, stat.title), h('span', null, stat.value ?? '—')),
                    ),
                  )
                : null,
            )
          : null,

        h('div', { style: SB.muted }, data?.updated_at ? `更新：${data.updated_at}` : ''),
        h('div', { style: SB.footnote }, '配置：设置 → Home Assistant'),
      )
    }

    function registerSidebarTab(ctx) {
      if (typeof ctx.inject !== 'function') return
      ctx.inject(['sidebarRightTabs'], (scoped) => {
        try {
          const tabs = typeof scoped.get === 'function' ? scoped.get('sidebarRightTabs') : undefined
          if (!tabs || typeof tabs.register !== 'function') return
          const slots = ctx.slots
          if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return

          ctx.effect(() => {
            const disposeType = tabs.register({
              id: SIDEBAR_TAB_ID,
              kind: SIDEBAR_TAB_ID,
              priority: 'extension',
              title: () => 'Home Assistant',
              guide: [
                {
                  id: 'status',
                  order: 56,
                  title: () => 'Home Assistant',
                  description: () => 'HA 状态速览',
                  icon: HaIcon,
                },
              ],
            })
            const disposeBody = slots.inject('sidebar.right.pane.tab', () =>
              slots.register(
                { name: 'sidebar.right.pane.tab', key: SIDEBAR_TAB_ID, inject: () => ({}) },
                SidebarPanel,
              ),
            )
            const disposeTitle = slots.inject('sidebar.right.pane.tab.title', () =>
              slots.register(
                { name: 'sidebar.right.pane.tab.title', key: SIDEBAR_TAB_ID, inject: () => ({}) },
                SidebarTitle,
              ),
            )
            return () => {
              disposeBody()
              disposeTitle()
              disposeType()
            }
          }, 'home-assistant: right sidebar status tab')
        } catch (error) {
          console.warn('[dsh-home-assistant] 右侧栏状态卡未注册（设置页不受影响）：', error)
        }
      })
    }

    const NOTIFY_TAG = 'dsh-home-assistant-status'
    const NOTIFY_DEDUPE_KEY = 'dsh-home-assistant:last-notify'

    function notificationSupported() {
      return typeof window !== 'undefined' && typeof window.Notification === 'function'
    }

    function notificationPermission() {
      if (!notificationSupported()) return 'unsupported'
      return window.Notification.permission || 'default'
    }

    function shouldSendNotification(kind) {
      try {
        const now = Date.now()
        const raw = window.localStorage?.getItem(NOTIFY_DEDUPE_KEY)
        const previous = raw ? JSON.parse(raw) : null
        if (previous && previous.kind === kind && now - Number(previous.at) < 15000) return false
        window.localStorage?.setItem(NOTIFY_DEDUPE_KEY, JSON.stringify({ kind, at: now }))
      } catch {
        /* localStorage may be unavailable; duplicates are acceptable */
      }
      return true
    }

    function sendStatusNotification(kind, data) {
      if (!notificationSupported() || window.Notification.permission !== 'granted') return
      const title = kind === 'down' ? 'Home Assistant 不可用' : 'Home Assistant 已恢复'
      const label = data?.label || 'Home Assistant'
      const state = data?.core_state || (kind === 'down' ? 'UNREACHABLE' : 'RUNNING')
      const hint = Array.isArray(data?.hints) && data.hints[0] ? ` · ${data.hints[0]}` : ''
      try {
        const notification = new window.Notification(title, {
          body: `${label} · ${state}${hint}`,
          tag: NOTIFY_TAG,
        })
        notification.onclick = () => {
          try {
            window.focus()
          } catch {
            /* focus is best effort */
          }
          try {
            notification.close()
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* notifications can fail (permissions, insecure context); never break the watcher */
      }
    }

    function watchStatus(readNotify) {
      let alive = true
      let baseline = true
      let confirmed = null
      let downCount = 0
      let upCount = 0
      let timer = null

      const tick = async () => {
        if (!alive) return
        const cfg = readNotify() || {}
        if (cfg.enabled !== true) return
        let data
        try {
          const response = await fetch(ROUTE, { cache: 'no-store' })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          data = await response.json()
        } catch (error) {
          data = { ok: false, configured: true, core_state: 'UNREACHABLE', hints: [String(error?.message ?? error)] }
        }
        if (!alive) return
        if (data?.pending) return
        if (data?.configured === false || data?.auth_source === 'none') return

        const state = String(data?.core_state || '').toUpperCase()
        const healthy = data?.ok === true && !['NOT_RUNNING', 'STARTING', 'STOPPING', 'UNKNOWN', 'UNREACHABLE'].includes(state)

        if (baseline) {
          confirmed = healthy ? 'up' : 'down'
          baseline = false
          downCount = 0
          upCount = 0
          return
        }

        if (healthy) {
          upCount += 1
          downCount = 0
        } else {
          downCount += 1
          upCount = 0
        }

        const threshold = Math.max(1, Number(cfg.failureThreshold) || 2)

        if (!healthy && downCount >= threshold && confirmed !== 'down') {
          confirmed = 'down'
          const canNotify =
            cfg.onDown !== false &&
            notificationPermission() === 'granted' &&
            shouldSendNotification('down')
          if (canNotify) sendStatusNotification('down', data)
        }

        if (healthy && upCount >= threshold && confirmed !== 'up') {
          confirmed = 'up'
          const canNotify =
            cfg.onRecover !== false &&
            notificationPermission() === 'granted' &&
            shouldSendNotification('up')
          if (canNotify) sendStatusNotification('up', data)
        }
      }

      tick()
      timer = setInterval(tick, 30000)
      const onVisibility = () => {
        if (alive && typeof document !== 'undefined' && document.visibilityState === 'visible') tick()
      }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
      return () => {
        alive = false
        if (timer) clearInterval(timer)
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      }
    }

    function startStatusNotifier(ctx) {
      const form = ctx.configForms?.get?.(ENTRY_ID)
      if (!form || typeof form.getSnapshot !== 'function') return () => {}
      let stop = null
      const readNotify = () => {
        const snapshot = form.getSnapshot()
        return snapshot?.value?.notify && typeof snapshot.value.notify === 'object' ? snapshot.value.notify : {}
      }
      const ensure = () => {
        const enabled = readNotify().enabled === true
        if (enabled && !stop) stop = watchStatus(readNotify)
        if (!enabled && stop) {
          stop()
          stop = null
        }
      }
      let unsubscribe = () => {}
      if (typeof form.subscribe === 'function') {
        const result = form.subscribe(ensure)
        if (typeof result === 'function') unsubscribe = result
      }
      ensure()
      return () => {
        try {
          unsubscribe()
        } catch {
          /* ignore */
        }
        if (stop) {
          stop()
          stop = null
        }
      }
    }

    function HomeAssistantPage() {
      const [state, reload] = useStatus()
      return h(
        'div',
        { style: { display: 'grid', gap: 16, padding: '20px 24px 32px', maxWidth: 1080, margin: '0 auto' } },
        h(
          'div',
          { style: { display: 'grid', gap: 3 } },
          h('h2', { style: { margin: 0, fontSize: 20, fontWeight: 600 } }, 'Home Assistant'),
          h('div', { style: { fontSize: 12, opacity: 0.6 } }, '只读状态总览 · 配置在 设置 → Home Assistant'),
        ),
        h(StatusBlock, { state, reload, data: state.data }),
        h(
          'div',
          { style: { fontSize: 12, opacity: 0.55 } },
          '需要修改地址、令牌、观测项或注入策略时，打开 设置 → Home Assistant。',
        ),
      )
    }

    function registerMainPanel(ctx) {
      try {
        const slots = ctx.slots
        if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return
        slots.inject('sidebar.panellist', () =>
          slots.register(
            { name: 'sidebar.panellist', id: MAIN_PANEL_ID, order: 21, label: () => 'Home Assistant' },
            HaIcon,
          ),
        )
        slots.inject('main', () =>
          slots.register(
            { name: 'main', key: MAIN_PANEL_ID },
            HomeAssistantPage,
          ),
        )
      } catch (error) {
        console.warn('[dsh-home-assistant] 左侧主面板未注册（设置页/右侧栏不受影响）：', error)
      }
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
        try {
          registerSidebarTab(ctx)
        } catch (error) {
          console.warn('[dsh-home-assistant] 右侧栏状态卡初始化失败（设置页不受影响）：', error)
        }
        try {
          registerMainPanel(ctx)
        } catch (error) {
          console.warn('[dsh-home-assistant] 左侧主面板初始化失败（设置页/右侧栏不受影响）：', error)
        }
        try {
          if (typeof statusNotifierCleanup === 'function') statusNotifierCleanup()
          const cleanup = startStatusNotifier(ctx)
          statusNotifierCleanup = cleanup
          ctx.effect?.(() => () => {
            if (statusNotifierCleanup === cleanup) {
              cleanup()
              statusNotifierCleanup = null
            }
          })
        } catch (error) {
          console.warn('[dsh-home-assistant] 浏览器通知初始化失败（状态面板不受影响）：', error)
        }
      },
    }
  },
})
