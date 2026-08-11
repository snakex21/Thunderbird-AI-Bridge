# Thunderbird AI Bridge

[English / 전체 언어 목록](../../README.md)

## 무엇인가요?

Thunderbird AI Bridge는 Thunderbird와 AI 에이전트, CLI 도구, 스크립트 및 사용자 정의 애플리케이션을 연결하는 로컬 브리지입니다. 확장 프로그램이 메일함 작업을 수행하고, 로컬 프로그램은 `127.0.0.1`의 간단한 HTTP 프로토콜을 통해 통신합니다.

**SuperCLI는 필수가 아닙니다.** 최초의 host는 SuperCLI용으로 만들어졌지만 [docs/PROTOCOL.md](../PROTOCOL.md)에 설명된 프로토콜을 구현하는 어떤 프로그램도 이 확장을 사용할 수 있습니다.

## 기능

- 계정 및 폴더 목록 조회,
- 폴더 생성, 이름 변경 및 삭제,
- 발신자, 수신자/주소, 제목, 전체 텍스트 및 날짜 검색,
- 읽음/읽지 않음 상태를 의도적으로 바꾸지 않고 메시지 읽기,
- 긴 메시지를 구간별로 읽기,
- vision 모델 또는 문서 처리용 첨부 파일 목록 및 전송,
- 메시지 이동, 휴지통 이동 및 복원,
- IMAP 검증을 포함한 영구 삭제,
- Thunderbird 기본 Empty Trash/EXPUNGE,
- Outlook `.msg`를 `.eml`로 변환한 뒤 가져오기,
- continuation token을 사용하는 제한된 배치 작업.

## 보안

민감한 작업에는 추가 보호가 적용됩니다. 파괴적 작업에는 `confirm: true`가 필요하고, 영구 삭제는 휴지통에서만 허용되며 system/root 폴더는 보호됩니다. host도 파괴적 작업 전에 사용자에게 명확한 확인을 받아야 합니다.

이 bridge는 로컬 사용을 위해 설계되었습니다. host를 LAN이나 인터넷에 직접 노출하지 마세요.

## 빌드

Thunderbird 128 이상이 필요합니다.

```bash
python scripts/build_xpi.py
npm test
```

XPI는 `dist/thunderbird-ai-bridge.xpi`에 생성되며 Thunderbird 애드온 관리자에서 수동으로 설치할 수 있습니다.

상태: 실험적 (`0.9.21`). `1.0` 이전에는 프로토콜이 변경될 수 있습니다.

MIT 라이선스. Mozilla 또는 Thunderbird의 공식 프로젝트가 아닙니다.
