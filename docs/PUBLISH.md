# 上架清单（v0.1.0）

> 依据 [awesome-dsh-plugin 收录要求](https://awesome-dsh-plugin.com)（调研记录见 HA 工作区 `docs/研究/dsh-ha插件/02-上架流程与门槛.md`）。
> 当前状态：代码、`dsh.bundle.patch`、双语 README、图标、单元 harness 齐备；**缺 GitHub 远端与 npm 发布**。

## 1. 推出仓库

```sh
cd /data/dsh/home/dsh-home-assistant
git remote add origin git@github.com:hotkong/dsh-home-assistant.git   # 或 https
git push -u origin master
```

- 给仓库打 topic：`dsh-plugin`（上架硬性要求）
- 收录要求仓库**创建满 1 天**，当天提 PR 会被 CI 拒；先推上去，隔天再投

## 2. 发 npm

```sh
npm login
npm publish --access public
```

`repository` 已指向 `git+https://github.com/hotkong/dsh-home-assistant.git`，与收录仓库一致。

## 3. 验证安装

```sh
dsh plugin --profile web add dsh-home-assistant
```

## 4. 提市场 PR

向 `awesome-dsh-plugin/awesome-dsh-plugin` 新增一个文件 `data/plugins/hotkong__dsh-home-assistant.yml`：

```yaml
url: https://github.com/hotkong/dsh-home-assistant
name: hotkong/dsh-home-assistant
category: tools
description:
  en: Keeps a Home Assistant instance's identity and live status in the agent's system prompt - configure the URL and token once, then every session knows versions, core state, disk usage and up to six user-defined entity or template stats. Read-only, no control surface.
  zh: 把 Home Assistant 实例的身份与实时状态注入 agent 的系统提示词——配置一次地址与令牌，之后每个会话都知道版本、core 状态、磁盘占用，以及最多六个自定义的实体或模板统计。只读，不含控制能力。
icon: https://raw.githubusercontent.com/hotkong/dsh-home-assistant/main/assets/icon.svg
```

> 描述必须与代码一致：本插件**只有** 1 个工具、只读、不做控制——不要写"管理 Home Assistant"这类会被打回的表述。

## 5. 发布前自查

- [x] `package.json` 有 `dsh.bundle.patch` + 根目录 `cordis.patch.yml`
- [x] `exports["./client"]` 存在，`dsh.client.platform = "web"`
- [x] `engines.dsh` 声明（`>=0.2.1-rc.1 <0.3.0-0`）
- [x] 官方包走 `peerDependencies`，范围含预发布分支
- [x] 仓库内有真实代码（`lib/` 6 个模块 + `client/` + `test/`）
- [ ] 仓库满 1 天
- [ ] `dsh-plugin` topic
- [ ] npm 已发布
