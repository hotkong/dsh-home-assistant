// dsh-home-assistant — settings card.
// Plain React + inline styles on purpose: the card must render on any host build
// without depending on a specific primitives API surface.
window.__ModuleLoader__.load({
  id: 'dsh-home-assistant',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const ENTRY_ID = 'home-assistant'
    const ROUTE = '/dsh-home-assistant/status'

    function useStatus() {
      const [state, setState] = React.useState({ phase: 'loading', data: null, error: '' })
      const load = React.useCallback(async () => {
        try {
          const response = await fetch(ROUTE, { cache: 'no-store' })
          const data = await response.json()
          setState({ phase: 'ready', data, error: '' })
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

    const styles = {
      card: { display: 'grid', gap: 10, padding: '12px 14px', fontSize: 13, lineHeight: 1.5 },
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
      statRow: { display: 'flex', justifyContent: 'space-between', gap: 12 },
      button: {
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid rgba(127,127,127,.4)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12,
      },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, opacity: 0.7 },
    }

    function Card() {
      const [state, reload] = useStatus()
      const data = state.data
      const tone = state.phase !== 'ready' ? 'err' : data?.ok ? 'ok' : 'warn'

      return h(
        'div',
        { style: styles.card },
        h(
          'div',
          { style: styles.row },
          h('span', { style: styles.dot(tone) }),
          h('span', { style: styles.title }, data?.label || 'Home Assistant'),
          h('span', { style: styles.muted }, data?.url || ''),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', style: styles.button, onClick: reload }, '刷新'),
        ),
        state.phase === 'error' ? h('div', { style: styles.muted }, `读取状态失败：${state.error}`) : null,
        data?.pending ? h('div', { style: styles.muted }, '正在首次探测…') : null,
        data && !data.pending && !data.ok
          ? h(
              'div',
              null,
              (data.hints || []).map((hint, index) => h('div', { key: index, style: styles.muted }, `· ${hint}`)),
            )
          : null,
        data?.ok
          ? h(
              'div',
              { style: { display: 'grid', gap: 6 } },
              h(
                'div',
                { style: styles.muted },
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
                { style: styles.muted },
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
                    { style: { display: 'grid', gap: 4, marginTop: 2 } },
                    data.stats.map((stat, index) =>
                      h(
                        'div',
                        { key: index, style: styles.statRow },
                        h('span', { style: styles.muted }, stat.title),
                        h('span', null, stat.value ?? '—'),
                      ),
                    ),
                  )
                : null,
            )
          : null,
        h('div', { style: styles.mono }, data?.updated_at ? `更新：${data.updated_at}` : ''),
      )
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
        // 0.2.1 的插件详情页：包卡片下方的 section（本机渲染器确认存在）
        slots.inject('plugins.detail.section', () =>
          slots.register({ name: 'plugins.detail.section', key: ENTRY_ID, id: ENTRY_ID, order: 10 }, Card),
        )
        // 旧版/其它宿主：设置里的插件卡片
        slots.inject('settings.plugin.item', () =>
          slots.register({ name: 'settings.plugin.item', key: ENTRY_ID, id: ENTRY_ID, order: 10, locale: ENTRY_ID }, Card),
        )
      },
    }
  },
})
