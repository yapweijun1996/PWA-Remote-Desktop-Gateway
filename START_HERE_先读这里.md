# PWA Remote Desktop Gateway — 开发交接包

版本：1.0 · 编制日期：2026-10-02 · Owner：Wei Jun

当前实现状态：独立分支已加入 Java Gateway 和生产 PWA；请先读 `README.md`、`PROGRESS.md` 与 `qa/implementation/REPORT.md`。以下内容描述原始交接包；真实 Mac / 外网部署验收仍 BLOCKED。

**这是完整开发规格、配置蓝图、界面原型和可运行的参考测试，不是已经完成或部署的远程控制软件。**
不包含真实账号、OTP、Tunnel token、VNC password 或电脑截图。没有更改你的 Mac、Cloudflare、GitHub 或现有 MCP。

## 你要的体验

在 macOS / Windows 上打开浏览器 → 自己的域名 → Cloudflare Access 的指定 Email + OTP → 选择 Mac mini / MacBook Air → 远程桌面。
控制端不安装 AnyDesk 或浏览器扩展。被控制端必须有运行中的 Screen Sharing、Gateway 和 Tunnel。Mac 锁屏时可能仍需在远程画面输入 macOS 登录密码；Email OTP 不等于解锁 macOS。

## 已确定与设计选择

你已确定：自有域名、Cloudflare Tunnel、Cloudflare Access email OTP、浏览器操作、两台 Mac、跨 Windows/macOS 的键盘映射。
本包采用的**设计基线**：自有 JavaScript PWA + 小型 Java Gateway + Apache Guacamole 官方库 / guacd + macOS Screen Sharing。noVNC 不是必需依赖。
选择 Guacamole 官方 Java API 是为了复用桌面协议和 WebSocket 实现；不是要求你手写画面编码，也不是复制一个无认证的示例。
底层选择仍需实际 Mac 验证；不将设计选择伪装成你的明确指示或已完成测试。

## 键盘必须做好

- Mac → Mac：Command / Option / Control 保持语义，但浏览器拦截的快捷键仍需备用按钮。
- Windows → Mac 默认：Ctrl → Control，Alt → Option，Win/Meta → Command（仅在浏览器收到按键时）。
- 可选「Alt → Command」模式：**只映射左 Alt**；右 Alt / AltGr 保留原本输入行为。
- 不默认把 Ctrl+C 变成 Command+C，避免破坏 Terminal 的中断操作。
- 屏幕提供 Command、Option、Control、Shift、Esc、Tab、快捷组合和 Release all keys。
- Ctrl/Command 的组合、中文输入法、剪贴板、丢失 keyup、断线重连和多标签页都会进入验收。

## 交给 AI Agent

先让 Agent 读 `AGENTS.md` 与 `AI_AGENT_TASK_PROMPT.md`。最短启动指令：

> Read AGENTS.md and AI_AGENT_TASK_PROMPT.md. Implement the specified PWA Remote Desktop Gateway in a new isolated repository/worktree. Treat this archive as a specification and tested reference pack, not a finished application. Complete the P0 interoperability and security gates before public deployment. Do not modify existing tunnels, MCP services, host security settings or company devices without the required approval. Report real test evidence and blocked items honestly.

开发详细步骤在 `docs/11_IMPLEMENTATION_BACKLOG.md`；验收项目在 `qa/acceptance-matrix.csv`。

## 本机查看原型与运行参考测试

需要已安装 Node.js，参考包不需要下载 npm dependencies。

```sh
npm test
npm run preview
```

随后打开终端显示的本机地址（默认 `http://127.0.0.1:4173/prototype/`）。这是**无联网远控能力的设计原型**。可以预览设备入口、键盘模式、桌面工具栏和快捷键测试器；所有设备状态都标记为未验证。不要输入密码。

## 重要边界

Email OTP 是邮箱控制权验证，不能直接叫作 phishing-resistant MFA（抗钓鱼多因素认证）。初版按你选择使用 OTP，同时要求邮箱自身启用强 MFA。
PWA 离线只提供不含个人数据的说明页，不能离线远控。不能保证所有系统快捷键透传，也不能保证合盖、睡眠或 FileVault 重启后自动恢复。
示例域名使用 `remote-mini.example.com` / `remote-air.example.com`，避免默认 Universal SSL 对深层子域的覆盖问题。
上述外部事实、版本与限制的官方出处见 `docs/14_SOURCE_REGISTER.md`。

## 文件导航

`docs/` 产品、架构、安全、键盘、部署、PWA、运维和研发计划。
`contracts/` API、设备配置和键盘 profile 的机器可读合同。
`deployment/` 需要 Agent 实现和补齐的配置蓝图，不可当成一键部署成品。
`reference/` 可运行的纯逻辑参考模块与测试；不包含真实远程协议实现。
`prototype/` 可交互的设计参照；不伪装成真实桌面。
`diagrams/` 可编辑的 Mermaid 架构和流程图。
`qa/` 测试矩阵、报告模板与本包验证记录。
