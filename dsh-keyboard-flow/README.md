# dsh-keyboard-flow

纯键盘控制 DSH 工作区的本地客户端插件。不碰安装目录（`app.asar`），全部改动在 `~/.dsh/profiles/desktop/` 和本目录，升级 DSH 不丢。

## 做了什么

| 区域 | 键 | 行为 |
| --- | --- | --- |
| 左栏树 | `↑` `↓` / `j` `k` | 在可见行之间移动焦点 |
| | `PageUp` `PageDown` | 按可视高度翻一页 |
| | `Home` `End` | 跳到首行 / 末行 |
| | `→` | 工作区行折叠时展开；否则移到下一行 |
| | `←` | 工作区行展开时折叠；否则移到上一行 |
| | `Enter` `空格` | 激活不自带 Enter 处理的行（工作区行、搜索结果） |
| 会话内容 | `j` `k` | 向下 / 向上滚动一行 |
| | `PageDown` `PageUp` | 向下 / 向上翻一页 |
| | `Home` `End` | 跳到会话顶部 / 底部 |
| 搜索 | `Ctrl+K` 后 | 结果行现在可 Tab/方向键聚焦，`Enter` 打开 |
| 会话 | `Alt+J` / `Alt+K` | 下一个 / 上一个会话（可改键） |
| 焦点 | `F6` | 会话列表 → 输入框 → 会话内容 → 右侧面板 → 循环 |
| | `F7` | 在输入框和会话内容之间一键切换 |

`j`/`k` 和翻页键只在焦点不在输入框、终端或右侧面板时生效；DSH 在会话结束后会把焦点放回输入框，所以纯键盘阅读时按 `F7`（或 `F6`）把焦点移到「会话内容」，再 `j`/`k`。读完按 `F7` 直接回输入框，不用再走一遍四站循环。这些滚动键和树导航一样走捕获监听（为了支持按住 `j` 连续滚动），不出现在 `Ctrl+/` 里；`F6`、`F7`、`Alt+J/K` 这四个命令仍然可以改键。

## 验证状态

2026-11-17，Windows 桌面端实测：`Ctrl+/` → 「应用操作」分组里能看到「下一个会话 `Alt+J`」「上一个会话 `Alt+K`」，树导航可用。

「焦点循环 `F6`」当时没出现：`register()` 会遍历 `desktop:linux` 校验默认键位，而 `bindingIssue` 对**无修饰键**的组合返回 `modifier-required`，直接抛错。已改为只在 `desktop:macos` / `desktop:windows` 给 F6 默认值（`FKEY_PLATFORMS`），待重启确认。

2026-11-21 新增：会话内容 `j`/`k` 逐行滚动、`PageUp`/`PageDown` 翻页、`Home`/`End` 顶/底；左栏树也接受 `j`/`k` 和 `PageUp`/`PageDown`；`F6` 焦点循环里加了「会话内容」一站；新增 `F7` 在输入框和会话内容之间直接切换。`dev/test.mjs` 全部通过；另外在运行中的 Web GUI 里注入新 `client.js` 做了真实 DOM 实测（j 每次 31px、翻页、F6、F7 双向切换、树 j/k、输入框不抢键、模态框不穿透），全部通过。桌面端要重启 DSH 才会加载新客户端代码，重启后即可生效。

## DSH 原生的键盘能力（本插件之外）

先摸清现状再动手，省得重复造：

| 已经能 | 不能 |
| --- | --- |
| 会话行 `Tab` 聚焦、`Enter`/空格打开、`Shift+F10` 开菜单 | 左栏树没有 ↑↓，只能 Tab 一个个蹭 |
| 右栏页签 `Tab` 进去后 `←` `→` `Home` `End` 切换 | 工作区行 `Enter` 不展开/折叠 |
| `Ctrl+K` 打开会话搜索 | 搜索结果行不可聚焦，只能鼠标点 |
| `Ctrl+N` / `Ctrl+O` / `Ctrl+P` / `Ctrl+T` / `` Ctrl+\ `` / `` Ctrl+` `` 等 20 条命令 | 没有「焦点在左栏/正文/右栏之间跳」的键 |
| 输入框 `Ctrl+A` / `Ctrl+Backspace` / `Ctrl+Z` / `Shift+↑↓` | 输入框没有 readline 键：`Ctrl+U` 被编辑器当格式化吞掉，`Ctrl+K`/`Ctrl+W` 被全局命令抢走 |

## 安装

```powershell
powershell -ExecutionPolicy Bypass -File tools\install.ps1
```

然后**重启 DSH**（客户端插件在启动时组合进 `__DSH_BOOT__`，不重启不生效）。

安装做三件事：

1. 在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 里加 `link:` 指向本目录；
2. 在 `dsh.profile.bundles` 末尾追加 `@local/dsh-plugin-keyboard-flow`；
3. 在 profile 的 `node_modules/@local/` 下建目录联接。

改 package.json 前会备份成 `package.json.bak-keyboard-flow-<时间戳>`。装完先跑一遍 `tools\preflight.ps1` 再重启（见下文「改 profile 前的自检与一键还原」）。

## 回滚

```powershell
powershell -ExecutionPolicy Bypass -File tools\uninstall.ps1
```

删掉 bundles 条目、依赖条目和目录联接，重启即恢复原状。

## 已知边界

- 全部是 DOM 层实现，依赖这些约定：`[role=tree]` / `[role=treeitem]`、`data-row-key="session:<id>"`、`aria-expanded`、`[role=tab]`、`[data-conversation-scroll]`、`[data-conversation-content]`。DSH 大版本改结构时需要跟一下；失效时最多退回“只能鼠标”，不会报错。
- 桌面端快捷键层是全局且无视区域的，所以方向键**不能**注册进快捷键表（会把输入框的方向键一起吃掉）。本插件用带焦点作用域的捕获监听实现树导航和会话滚动：树导航只在焦点位于 `[role=tree]` 内时生效；会话滚动只在焦点不在输入框/终端/右侧面板、且没有模态框时生效。
- 会话滚动步长：`j`/`k` 一行（取正文段落的 `line-height`，当前 DSH 是 31px；取不到时兜底 24px），`PageUp`/`PageDown` 约 90% 视口，`Home`/`End` 顶/底。`F6` 会把「会话内容」作为一个焦点站，内容不够一屏时这一站会自动跳过；`F7` 是直接切换，不依赖这一站。
- 输入框里的 readline 键（`Ctrl+U` 删行等）不在本插件范围内。
- **默认键位只给桌面端**：注册表会用浏览器白名单（`isWebBindingAllowed`）校验**每一条**默认绑定，连桌面运行时也校验；`F6`、`Alt+J` 这类在浏览器里不被允许，会直接抛错、整条命令注册失败。所以 web 运行时这三条命令是“未绑定”，可以在 `Ctrl+/` 里自己选一个允许的组合（`Ctrl+Alt+键` 或 `Ctrl+Shift+键`）。树导航和会话滚动是捕获监听，不经过注册表，web 运行时也能用。
- `Alt+J` / `Alt+K` / `F6` 如果和你的其他工具冲突，在 `Ctrl+/` 里改。

## 改 profile 前的自检与一键还原

这两个脚本是给"改 profile 把 DSH 弄得起不来"准备的，和插件本身无关，换别的插件也照样能用。

### 自检：`tools\preflight.ps1`

```powershell
powershell -ExecutionPolicy Bypass -File tools\preflight.ps1
```

检查两样东西：

- `package.json`：有没有 UTF-8 BOM、是不是严格 UTF-8、能不能 `JSON.parse`、`dsh.profile.bundles` 结构对不对、`link:` 依赖指向的目录还在不在；
- `cordis.patch.yml`：用 `dsh --profile web --patch <该文件> --dump-config` 真解析一遍，YAML 语法错会直接报出来。

退出码 `0` 才重启；`1` 表示有问题，先修。找不到的第三方 bundle 只算警告（DSH 会跳过它、照常启动，只是功能缺失）。

验证过一次启动之后，把当前配置记成"已知可用"：

```powershell
powershell -ExecutionPolicy Bypass -File tools\preflight.ps1 -Promote
```

会写到 `~/.dsh/profiles/desktop/.known-good/`（`package.json` + `cordis.patch.yml` + 时间戳）。

### 还原：`tools\restore-profile.cmd`

应用起不来时**双击** `restore-profile.cmd`（或 `powershell -ExecutionPolicy Bypass -File tools\restore-profile.ps1`），输入 `YES` 确认，它会把 `.known-good` 写回去，写入前先把当前文件备份到 `backups\pre-restore-<时间戳>\`。

```powershell
powershell -ExecutionPolicy Bypass -File tools\restore-profile.ps1 -List      # 看有哪些快照
powershell -ExecutionPolicy Bypass -File tools\restore-profile.ps1 -Force     # 跳过确认
```

### 为什么需要这两个脚本

DSH 启动失败时会弹「DeepSeek Harness 无法使用」对话框，里面有「禁用第三方插件、备份 profile patch 并重启」按钮，能救大部分情况。但它要 `JSON.parse` 一遍 `package.json`——**如果 package.json 本身坏了（比如带 BOM），这个按钮也会失败**。2026-11-17 21:49 连续 4 次启动失败就是这种情况（`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*.log` 里 `Unexpected token '﻿'`，栈顶在 `readProfileManifest`）。

所以：`preflight.ps1` 负责"别让它坏"，`restore-profile.cmd` 负责"坏了也能从应用外面修回来"。

## 踩过的坑

- **内置的「禁用第三方插件」恢复也救不了 BOM**：那个按钮要先 `JSON.parse` 一遍 `package.json`，BOM 会让它同样失败。所以改完 profile 先跑 `tools\preflight.ps1`，别指望弹窗兜底。
- **BOM**：第一版 `install.ps1` 用 `Set-Content -Encoding UTF8` 重写 profile 的 `package.json`，PowerShell 5.1 会写 UTF-8 BOM，DSH 启动时 `JSON.parse` 直接崩（2026-11-17，连续 4 次启动失败，日志在 `%APPDATA%\@deepseek-ai\dsh-desktop\logs`）。现在脚本用 `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)`，写完读回校验（前 3 字节不是 `EF BB BF` 且能 `ConvertFrom-Json`），不合格就报错。**改这个脚本时别退回 `Set-Content`。**
- **F6 这类无修饰键的默认值只能给 windows/macos**：`bindingIssue` 对 `desktop:linux` 返回 `modifier-required`，`register()` 直接抛错，整条命令注册失败（其他平台不受影响，所以只有一条命令消失，很容易看漏）。
- **快捷键注册的三道坎**（都踩过）：①客户端服务要用 `inject: ["shortcuts"]` + `ctx.get('shortcuts')` 取，直接读 `ctx.shortcuts` 会静默拿到 `undefined`；②`register()` 会校验所有平台的默认绑定，web 白名单拒掉 `F6`/`Alt+键` 并抛错，所以默认键位只写 `desktop:*`；③键位冲突不是覆盖，是两个命令一起 `blocked`。

## 测试

```powershell
cd dev
npm install
node test.mjs
```

`dev/test.mjs` 用 jsdom 加载真实的 `client.js`，覆盖树导航、搜索结果激活、会话步进、F6 循环、输入框不抢键、dispose 清理。
