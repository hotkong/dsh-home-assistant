# dsh-home-assistant

[English](./README.en.md) | 中文

> 把 Home Assistant 的环境配一次，之后**每个新会话开局就知道它在哪、什么版本、什么状态**——不用再读文档、不用再抄令牌。

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：在 **设置 → Home Assistant** 里填好地址、令牌和 1–6 个「要看的值」，插件会把环境基线注入系统提示词，并提供一个只读的 `ha_status` 工具和一张实时状态卡。

```text
<home_assistant label="客厅 HA" url="http://homeassistant.local:8123">
Core 2026.10.4 ｜ Supervisor 2026.10.4 ｜ OS 18.3.1
状态：RUNNING（recovery_mode=false，watchdog=true）
规模：42 实体 / 7 设备 / 3 区域 / 5 集成
磁盘：已用 13.8/27.7 GB
统计：亮灯数 3 ｜ 室内温度 22.0 °C ｜ 在家 1
备注：重启约 4.5–5 分钟；YAML 配置文件无 API，控制走 HA 原生界面
更新：2026-11-04 16:34 (+08:00)
</home_assistant>
```

上面这段会出现在**每次请求的系统提示词**里（约 150–300 token），所以新会话第一句就能准确回答问题；换一个 workspace 也一样——配置存在 profile 里，所有 workspace 共享。

## 安装

```sh
dsh plugin --profile web add dsh-home-assistant
```

装完刷新页面（或重启 `dsh web`）。插件在市场里的名字是 `dsh-home-assistant`。

本地开发时可以把仓库 `link:` 进 profile 的 `dependencies`，并把包名加进 `dsh.profile.bundles`；插件自带的 `cordis.patch.yml` 会自动插入 `home-assistant` 行，profile 的 patch 只需覆盖 `config`。本机就是这么跑的（见 `openspec/changes/0001-dsh-ha-plugin/tasks.md` 的验证记录）。

## 怎么用

装好之后有四个入口：

1. **左侧主面板（完整总览）**：左侧导航里的 **Home Assistant**。打开后是只读状态总览：版本、运行状态、规模、磁盘、时区、全部观测项、更新时间、刷新/打开 HA；配置入口提示在设置页。
2. **右侧栏速览（紧凑卡）**：在右侧栏的 **+ / 指南** 里添加 **Home Assistant**。显示状态点、Core/Supervisor 版本、运行状态、实体规模、最多 3 个观测项和更新时间；每 30 秒刷新（隐藏时暂停），可点「刷新」强制探测、「打开」跳转 HA 实例。
3. **配置（设置页）**：打开 **设置（Settings）→ Home Assistant**。页面顶部是完整状态卡，下面是配置表单：实例地址、显示名、备注、**访问令牌**（保存到凭据库）、观测项（最多 6 个）、是否注入提示词、**注入工作区白名单**、是否统计规模。点「保存配置」/「保存令牌」立即生效，不需要重启。
4. **让 agent 用**：直接问「看下 HA 状态」，它会调 `ha_status`；而**每轮系统提示词本来就带着环境块**，所以更省事——直接问「家里现在几盏灯亮着」它也答得上来。

> 设置页注册在 `settings.section`；左侧主面板注册在 `sidebar.panellist` + `main`（与 `dsh-github-flow` 同一套机制）；右侧栏注册在官方 `sidebarRightTabs` + `sidebar.right.pane.tab`（与 `dsh-github-workbench` 同一套机制）。宿主缺少对应服务时该入口静默跳过，其余入口与 `ha_status` 不受影响；没有 `configForms` 时，表单退化为只读提示。

### 浏览器通知

设置页新增「浏览器通知」一节，默认关闭：

- 只通知 **HA 不可用 / 恢复**，不监听设备事件；
- 首次加载只记基线，不会一打开就弹；
- 连续失败 `failureThreshold` 次（默认 2）才判定 DOWN；
- 权限必须在设置页点击「启用浏览器通知」申请，可发测试通知；
- 通知需要 DSH 页面保持打开。

## 访问令牌

**UI 推荐**：设置 → Home Assistant →「访问令牌」粘贴长期令牌 →「保存令牌」。它通过宿主凭据服务写入 `$DSH_HOME/.credentials.yaml` 的 `HA_TOKEN`，**不会**进 profile 配置、日志或市场备份；旁边的「清除」可移除。页面会显示当前解析结果（如 `credential:HA_TOKEN` 或 `未找到令牌`）。

**手动/高级（可选）**：也可以自己维护凭据文件（权限必须是 `0600`）：

```yaml
version: 1
refs:
  HA_TOKEN: <你的长期访问令牌>
```

插件默认读 `HA_TOKEN`。`tokenRef` 是给这种高级场景用的**凭据键名**，UI 不暴露它：默认 `HA_TOKEN`；改成 `FOO` 就要在 `refs` 下加 `FOO: <令牌>`，否则会退到同名环境变量。

**兜底（不建议）**：在 profile YAML 里写内联 `token`，会**明文**落在 `cordis.patch.yml` 并进入「包含配置文件」的备份。

令牌在 HA 的「用户资料 → 安全 → 长期访问令牌」里创建。只读场景建议用**非管理员用户**的令牌：状态读取不需要管理员，个别字段（设备/区域/集成计数）会降级为空。

## 配置项

| 字段 | 说明 |
|---|---|
| `baseUrl` | HA 地址，含端口，如 `http://homeassistant.local:8123` |
| `label` | 显示名，进注入块与状态卡 |
| `notes` | 自由备注（如「重启约 5 分钟」），只写入注入块；仅注入开启时生效 |
| `stats` | 1–6 个观测项，见下 |
| `tokenRef` / `token` | 高级：仅 profile YAML。UI 通过凭据服务固定写 `HA_TOKEN`；`tokenRef` 是键名，不是令牌 |
| `inject.enabled` / `refreshSec` / `maxChars` | 全局注入开关、刷新间隔、字数上限（默认 600） |
| `inject.workspaces` | 工作区白名单：只在这些绝对路径（含子目录）自动注入；空数组 = 所有工作区。`ha_status` 不受影响 |
| `status.refreshSec` / `timeoutMs` / `showScale` | 状态缓存 TTL、请求超时、是否统计规模 |

### 观测项（stats）

每个观测项二选一：

```yaml
stats:
  # 1) 实体快捷方式（不需要管理员令牌）
  - title: 室内温度
    entity: sensor.living_room_temperature
    unit: " °C"
  # 2) Jinja 模板（需要管理员令牌；可做聚合）
  - title: 亮灯数
    template: "{{ states.light | selectattr('state','eq','on') | list | count }}"
```

- 可选 `attribute` 读取实体的某个属性；
- 单项失败只显示 `—`，不影响其它项；
- 模板**只能来自配置**，工具参数不接受模板（HA 的模板接口能读取全屋状态）。

## 它做什么 / 不做什么

**做**：连接探测（版本 / core 状态 / recovery / watchdog / 磁盘 / 规模）、观测项取值、系统提示词注入、设置页状态卡、`ha_status` 工具。

**不做**（有意为之）：

- 控制设备 → 用 HA 原生界面，或接 HA 官方 MCP Server；
- 改配置 / 重启 / 查日志 / 编辑自动化 / 备份 / 读 YAML → 用 HA 原生界面或 [ha-mcp](https://github.com/homeassistant-ai/ha-mcp)；
- 多实例（v0.1 不支持，可用不同 profile）。

## 安全

- 探测**只发只读请求**，从不修改 HA；
- 令牌在日志、注入块、状态卡、浏览器里都会被替换成 `***`；
- 注入块在系统提示词组装时**只读缓存**，不等网络——HA 挂了不会卡住对话；
- 凭据文件请保持 `0600`；内联 `token` 的风险见上。

## 故障排查

| 现象 | 先查什么 |
|---|---|
| Settings 里没有「Home Assistant」 | `dsh --profile web --dump-config \| grep home-assistant`；没有行 = 没加进 `dsh.profile.bundles`（只装进 `node_modules` 不够） |
| 页面在，但表单显示「没有配置命名空间」 | `Config` 没加载：`@deepseek-ai/schemastery` 解析失败。`link:` 安装时按真实路径找模块，需要给插件自己的 `node_modules` 补链接 |
| 点保存被拒绝 / 没反应 | 字段必须在 `volatile()` 之下；看浏览器网络里的 `settings/mutate` 错误信息 |
| 重启后第一条提示词说「没有令牌」 | 凭据服务尚未就绪的启动竞态；插件对「无凭据」失败使用 5 秒短 TTL，稍等会自愈 |
| 状态一直不可达 | `curl '<baseUrl>/api/' -H "Authorization: Bearer $HA_TOKEN"`；再试 `GET /dsh-home-assistant/status?refresh=1` |

## License

MIT
