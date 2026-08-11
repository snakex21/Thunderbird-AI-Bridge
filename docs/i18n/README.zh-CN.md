# Thunderbird AI Bridge

[English / 完整语言列表](../../README.md)

## 这是什么？

Thunderbird AI Bridge 是 Thunderbird 与 AI Agent、CLI 工具、脚本和自定义应用之间的本地桥接层。扩展负责执行邮箱操作，本地程序通过 `127.0.0.1` 上的轻量 HTTP 协议与扩展通信。

**不需要 SuperCLI。** 最初的 host 是为 SuperCLI 编写的，但任何程序只要实现 [docs/PROTOCOL.md](../PROTOCOL.md) 中描述的协议，都可以使用此扩展。

## 功能

- 列出邮箱账户和文件夹，
- 创建、重命名和删除文件夹，
- 按发件人、收件人/地址、主题、全文和日期搜索，
- 读取邮件而不主动修改已读/未读状态，
- 分段读取较长邮件，
- 列出并传输附件，供视觉模型或文档处理程序使用，
- 移动邮件、移入垃圾箱和恢复，
- 带 IMAP 验证的永久删除，
- 使用 Thunderbird 原生 Empty Trash/EXPUNGE，
- 导入从 Outlook `.msg` 转换得到的 `.eml` 邮件，
- 使用 continuation token 分批执行批量操作。

## 安全

敏感操作包含额外保护。破坏性操作需要 `confirm: true`，永久删除仅允许在垃圾箱中执行，系统/root 文件夹受到保护。host 也应在破坏性操作前向用户取得明确确认。

该 bridge 面向本地使用。不要把 host 直接暴露到局域网或互联网。

## 构建

需要 Thunderbird 128 或更高版本。

```bash
python scripts/build_xpi.py
npm test
```

XPI 会生成到 `dist/thunderbird-ai-bridge.xpi`，可通过 Thunderbird 附加组件管理器手动安装。

状态：实验版（`0.9.21`）。在 `1.0` 之前协议仍可能变化。

MIT 许可证。独立项目，与 Mozilla 或 Thunderbird 无官方关联。
