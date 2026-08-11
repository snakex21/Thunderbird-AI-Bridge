# Thunderbird AI Bridge

[English / সব ভাষার তালিকা](../../README.md)

## এটি কী?

Thunderbird AI Bridge হলো Thunderbird এবং AI agent, CLI tool, script ও নিজস্ব application-এর মধ্যে একটি local bridge। Extension মেইলবক্সের কাজগুলো করে, আর একটি local program `127.0.0.1`-এ ছোট HTTP protocol-এর মাধ্যমে তার সঙ্গে যোগাযোগ করে।

**SuperCLI প্রয়োজন নয়।** প্রথম host SuperCLI-এর জন্য তৈরি হয়েছিল, কিন্তু [docs/PROTOCOL.md](../PROTOCOL.md)-এ বর্ণিত protocol বাস্তবায়ন করলে যেকোনো program এই extension ব্যবহার করতে পারে।

## বৈশিষ্ট্য

- account ও folder তালিকা,
- folder তৈরি, rename ও delete,
- sender, recipient/address, subject, full text ও date দিয়ে search,
- read/unread অবস্থা ইচ্ছাকৃতভাবে না বদলে message পড়া,
- বড় message অংশে অংশে পড়া,
- vision model বা document processing-এর জন্য attachment তালিকা ও transfer,
- message move, Trash-এ পাঠানো ও restore,
- IMAP verification সহ permanent delete,
- Thunderbird-এর native Empty Trash/EXPUNGE,
- `.eml`-এ convert করা Outlook `.msg` import,
- continuation token সহ সীমিত batch operation।

## নিরাপত্তা

সংবেদনশীল operation-এ অতিরিক্ত সুরক্ষা আছে। destructive action-এর জন্য `confirm: true` দরকার, permanent delete শুধু Trash থেকে করা যায় এবং system/root folder সুরক্ষিত। host-কেও ব্যবহারকারীর স্পষ্ট অনুমতি নিতে হবে।

Bridge local ব্যবহারের জন্য তৈরি। host-কে সরাসরি LAN বা Internet-এ expose করবেন না।

## Build

Thunderbird 128 বা নতুন সংস্করণ প্রয়োজন।

```bash
python scripts/build_xpi.py
npm test
```

XPI তৈরি হবে `dist/thunderbird-ai-bridge.xpi`-এ এবং Thunderbird Add-ons Manager থেকে manually install করা যাবে।

অবস্থা: experimental (`0.9.18`)। `1.0`-এর আগে protocol পরিবর্তিত হতে পারে।

MIT License। এটি Mozilla বা Thunderbird-এর অফিসিয়াল প্রকল্প নয়।
