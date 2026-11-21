# DSH 定制插件集

个人使用的 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）本地插件。全部以本地 `link:` bundle 的方式装进 DSH profile，不改安装目录（`app.asar`），升级 DSH 不会丢。

## 插件

| 目录 | 包名 | 作用 |
| --- | --- | --- |
| [`dsh-keyboard-flow/`](dsh-keyboard-flow/) | `@local/dsh-plugin-keyboard-flow` | 纯键盘控制工作区：左栏树 ↑↓/j/k/Home/End/PageUp/PageDown、会话内容 j/k 滚动与翻页、`F6` 焦点循环、`F7` 输入框↔会话内容直切、`Alt+J/K` 切会话 |
| [`dsh-plugin-claude-commands/`](dsh-plugin-claude-commands/) | `@local/dsh-plugin-claude-commands` | Claude Code 风格的斜杠命令：`/code-review`、`/revise-claude-md` |
| [`dsh-plugin-claude-hooks/`](dsh-plugin-claude-hooks/) | `@local/dsh-plugin-claude-hooks` | 会话启动时运行 Claude Code 兼容的 `SessionStart` hooks，把 `{"systemMessage": ...}` 注入系统提示 |

每个子目录都是独立的 DSH bundle 包，可以单独安装，也可以整包一起用。

## 安装

插件通过 profile 的 `package.json` 依赖 + `dsh.profile.bundles` 条目加载：

1. 把对应子目录放到任意位置（本仓库克隆下来即可）；
2. 在 `~/.dsh/profiles/<profile>/package.json` 的 `dependencies` 里加
   `"@local/dsh-plugin-xxx": "link:<该子目录的绝对路径>"`；
3. 在 `dsh.profile.bundles` 末尾追加 `@local/dsh-plugin-xxx`；
4. 在 `<profile>/node_modules/@local/` 下建目录联接（Windows 用 `New-Item -ItemType Junction`）；
5. 重启 DSH（客户端插件在启动时组合进 `__DSH_BOOT__`）。

`dsh-keyboard-flow` 自带 `tools/install.ps1` / `uninstall.ps1` 自动完成第 2–4 步，改 profile 前建议先跑 `tools/preflight.ps1`。

## 个人配置放哪

插件自带的 `cordis.patch.yml` 只放通用默认值。**本机路径、日志位置、要运行的 hook 命令这类个人配置，放在 profile 层**：

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: claude-code-hooks
  name: "@local/dsh-plugin-claude-hooks"
  config:
    logFile: 'C:\Users\<you>\.dsh\logs\claude-code-hooks.log'
    includeSubagents: false
    hooks:
      SessionStart:
        - command: 'C:\Program Files\Git\bin\bash.exe'
          args: ['C:\Users\<you>\.claude\hooks\check-claude-md.sh']
          timeoutMs: 15000
```

profile 层在 bundle 层之后应用，按 `id` 覆盖插件配置，所以本仓库里不会出现个人路径。

## 兼容性

- 针对 DSH `0.2.2-rc.5` 测试。`dsh-plugin-claude-commands` 的 `peerDependencies` 钉在 `@deepseek-ai/dsh-llm 0.2.2-rc.5`；DSH 对本地 bundle 做精确版本校验，升级运行时后若版本号对不上会直接跳过该 bundle，需要同步改这个版本（或在 profile 上授予 exact-version exemption）。
- 所有插件都是纯 JS，无构建步骤；`dsh-keyboard-flow/dev` 里的测试用 jsdom，`npm install && node test.mjs`。

## 许可

[MIT](LICENSE) © 2026 visionjam
