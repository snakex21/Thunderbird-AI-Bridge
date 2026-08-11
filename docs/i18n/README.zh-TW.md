# Thunderbird AI Bridge

[English / 完整語言列表](../../README.md)

## 這是什麼？

Thunderbird AI Bridge 是 Thunderbird 與 AI Agent、CLI 工具、腳本和自訂應用程式之間的本機橋接層。擴充套件負責執行信箱操作，本機程式則透過 `127.0.0.1` 上的輕量 HTTP 協定與它通訊。

**不需要 SuperCLI。** 最初的 host 是為 SuperCLI 建立的，但任何程式只要實作 [docs/PROTOCOL.md](../PROTOCOL.md) 所描述的協定，就能使用此擴充套件。

## 功能

- 列出郵件帳號與資料夾，
- 建立、重新命名與刪除資料夾，
- 依寄件者、收件者/地址、主旨、全文與日期搜尋，
- 讀取郵件而不主動變更已讀/未讀狀態，
- 分段讀取長郵件，
- 列出並傳輸附件給 vision 模型或文件處理工具，
- 移動郵件、移至垃圾桶並還原，
- 具有 IMAP 驗證的永久刪除，
- 使用 Thunderbird 原生 Empty Trash/EXPUNGE，
- 匯入由 Outlook `.msg` 轉換成的 `.eml` 郵件，
- 使用 continuation token 進行有限批次的大量操作。

## 安全性

敏感操作具有額外保護。破壞性操作需要 `confirm: true`，永久刪除僅能從垃圾桶執行，system/root 資料夾受到保護。host 也應在破壞性操作前取得使用者明確確認。

此 bridge 以本機使用為目的。不要將 host 直接暴露到區域網路或網際網路。

## 建置

需要 Thunderbird 128 或更新版本。

```bash
python scripts/build_xpi.py
npm test
```

XPI 會產生於 `dist/thunderbird-ai-bridge.xpi`，可從 Thunderbird 附加元件管理員手動安裝。

狀態：實驗性（`0.9.21`）。在 `1.0` 前協定仍可能變更。

MIT 授權。獨立專案，與 Mozilla 或 Thunderbird 無官方關聯。
