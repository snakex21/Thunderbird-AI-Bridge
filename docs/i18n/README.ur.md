# Thunderbird AI Bridge

[English / تمام زبانوں کی فہرست](../../README.md)

## یہ کیا ہے؟

Thunderbird AI Bridge، Thunderbird اور AI agents، CLI tools، scripts اور custom applications کے درمیان ایک مقامی bridge ہے۔ Extension mailbox پر کام کرتی ہے اور ایک local program `127.0.0.1` پر ایک چھوٹے HTTP protocol کے ذریعے اس سے رابطہ کرتا ہے۔

**SuperCLI ضروری نہیں ہے۔** پہلا host SuperCLI کے لیے بنایا گیا تھا، لیکن [docs/PROTOCOL.md](../PROTOCOL.md) میں بیان کیا گیا protocol نافذ کرنے والا کوئی بھی program extension استعمال کر سکتا ہے۔

## خصوصیات

- accounts اور folders کی فہرست،
- folders بنانا، نام بدلنا اور حذف کرنا،
- sender، recipient/address، subject، full text اور date کے ذریعے search،
- read/unread حالت کو جان بوجھ کر تبدیل کیے بغیر message پڑھنا،
- لمبے messages کو حصوں میں پڑھنا،
- vision models یا document processing کے لیے attachments کی فہرست اور transfer،
- messages move کرنا، Trash میں بھیجنا اور restore کرنا،
- IMAP verification کے ساتھ permanent delete،
- Thunderbird کا native Empty Trash/EXPUNGE،
- `.eml` میں تبدیل شدہ Outlook `.msg` messages import کرنا،
- continuation token کے ساتھ محدود batch operations۔

## سیکیورٹی

حساس operations کے لیے اضافی حفاظت موجود ہے۔ destructive actions کے لیے `confirm: true` ضروری ہے، permanent deletion صرف Trash تک محدود ہے اور system/root folders محفوظ ہیں۔ host کو بھی صارف سے واضح اجازت لینی چاہیے۔

Bridge مقامی استعمال کے لیے بنایا گیا ہے۔ host کو براہ راست LAN یا Internet پر expose نہ کریں۔

## Build

Thunderbird 128 یا جدید ورژن درکار ہے۔

```bash
python scripts/build_xpi.py
npm test
```

XPI `dist/thunderbird-ai-bridge.xpi` میں بنتا ہے اور Thunderbird Add-ons Manager سے manually install کیا جا سکتا ہے۔

حالت: experimental (`0.9.21`)۔ `1.0` سے پہلے protocol بدل سکتا ہے۔

MIT License۔ یہ Mozilla یا Thunderbird کا official project نہیں ہے۔
