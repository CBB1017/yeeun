> 역사 기록: 현행 요구는 proposal/specs 및 design.md가 연결하는 구현 계약이다. 이 파일의 과거 미정·제안은 현행 결정을 덮어쓰지 않는다.

# 결정 기록

## 사용자에게 확인된 요구

2026-11-02 최초 요청의 1–6항을 proposal.md에 기록했다.

## 미정 사항

1. 사용자 범위: 본인 전용 또는 타 사용자 포함. 타 사용자의 계정 및 파일 접근 권한.
2. 접속 범위: 같은 PC, 같은 네트워크의 모바일/PC, 외부 네트워크.
3. 첫 업무 사례와 최종 산출물: 요약, 수치 분석, 보고서, 실제 파일 생성/수정 등.
4. 독립 실행 및 대조 순서, 원본 근거 검증, 불일치 처리, 최종 정리 담당 도구.
5. Google Drive 접근 방식: 계정 연동, 공유 링크, 로컬 동기화 폴더 등.
6. 파일 처리 깊이: 텍스트/표, 수식, 차트, 이미지, 스캔 PDF OCR, 원본 위치 인용.
7. 요청/원본/중간 결과/최종 결과 보관 위치 및 기간.
8. 구독 상태와 사용량 한도 도달 시 처리. 별도 유료 경로 사용 여부.
9. Open Design 실행 모드 및 설치/연결. 화면 스타일, 언어, 서비스 이름.
10. 프론트/백엔드 기술 스택, 실행/배포 방식, 작업 큐 및 동시 실행 정책.
11. 디자이너/개발자 검토 수행 방식과 승인 기준.

## 읽기 전용 환경 확인

- 현재 작업 폴더에는 .git 외에 프로젝트 소스가 확인되지 않았다.
- PATH에서 codex.exe를 확인했다. claude 및 openspec 명령은 확인되지 않았다. 미설치라고 단정하지 않는다.
- 현재 세션에 Open Design 도구가 노출되어 있지 않다.
- `codex mcp get open-design --json`은 해당 MCP 등록이 없다고 반환했다.
- Open Design 설치 여부는 확정하지 못했다. 설치나 설정 변경은 수행하지 않았다.

## 참고 자료

- Codex 비대화형 실행: https://developers.openai.com/codex/noninteractive
- Claude Code 비대화형 실행: https://code.claude.com/docs/en/headless
- OpenSpec 시작 안내: https://github.com/Fission-AI/OpenSpec/blob/main/docs/getting-started.md

OpenSpec CLI가 확인되지 않아 초기화 및 CLI 검증은 수행하지 않았다. 이 파일들은 OpenSpec 변경 제안을 위한 초안이며 검증 완료 명세가 아니다.
