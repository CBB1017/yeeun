# 반응형 웹 UX 명세

## 방향 및 토큰

UI/UX Pro Max 적용. 자료 업무용 flat dashboard, 밝은 neutral 배경·teal primary·제한된 상태색. 마케팅 hero/장식 chart 제외. 로컬 검색의 flat 스타일만 제품 맥락에 적용하고 landing 섹션 추천은 채택하지 않았다. 한국어 기본, system sans-serif/한국어 fallback, 외부 font/CDN 의존 불필요. 서비스 작업명 Yeeun은 최종 브랜드명으로 강제하지 않는다.

semantic tokens: background #F8FAFC, surface #FFFFFF, text #0F172A, muted #475569, border #CBD5E1, primary #0F766E/white, danger #B91C1C/white, warning #92400E/light surface, focus #0F766E. 4/8 spacing, body 16px/1.5, table 최소 14px, radius 8px, 150–200ms 제한된 transition. 실제 조합 AA contrast 검증, reduced-motion 준수, 색상만으로 상태를 구분하지 않는다.

## 화면과 흐름

1. 로그인: 목적·소유자 구독 공유 안내, Google 로그인, 미초대 안내.
2. 홈: 자연어 입력을 우선 배치. 내 작업/예약/최근 결과, 진행/검토 필요/오류. 소유자 CLI 인증 문제는 설정 안내로 표현하고 일반 사용자에게 token/path를 노출하지 않는다.
3. 파일 허용: Drive 파일 추가(Picker), 허용 목록·계정·접근 취소. 검색 범위 명시. 0건이면 파일 추가를 제공하며 전체 Drive를 몰래 검색하지 않는다.
4. 업무 설정: 원문에서 해석한 목표/파일/범위/산출물/일정·시간대/다음 3회 시각/알림을 검토. 복수 후보는 이름·형식·수정 시각·표시 가능한 폴더 정보를 제공하고 직접 선택. 모호한 항목만 질문. 즉시 실행/예약 저장을 구분. 임의 반복·휴일 규칙 없음.
5. 진행: queued/preparing/각 CLI 진행/comparing/finalizing. 실제 상태만 표시, 가짜 진행률 금지. 취소 가능. 검토 대기 lane 때문에 대기하는 경우 설명과 검토 열기/취소 제공.
6. 결과: 답변/원본 표/다운로드, 원본 버전·확보시각·담당·검산. 헤더·컬럼 순서·행 값을 유지하고 보조 상태/근거는 분리 패널에 표시.
7. 근거: claim/행 선택 -> 파일·시트/셀/페이지/슬라이드/영역, provider revision 또는 local snapshot/hash, 확보시각, 발췌·강조 미리보기, 원본 Drive 열기. 원본 링크는 현재 버전일 수 있음을 표시. 정리 후에는 '원본 스냅샷 정리됨; 분석 당시 근거 보관' 안내.
8. 불일치: 양쪽 원문·필드 차이·검산 실패. 1차는 최초 원본으로 재검토/취소, 2차는 미해결·알림 상태. 별도 새 작업은 새 source/run임을 명시.
9. 외부 전송: 대상/동작/파일 hash·preview를 확인하고 승인/거부. 변경 시 재승인.
10. 알림: email/push 독립, verified recipient/permitted sender, 기기 권한. 테스트 발송은 사용자 버튼으로만. 0건 알림의 '오늘은 알림 더 표시 안함'은 해당 작업 정상 알림만 대상임을 설명.
11. 설정/관리: timezone, Drive, 초대/revoke, sender, storage root, capability health. 경로 변경은 적용 필요/검증/이동 단계를 보여주고 무단 이동·삭제하지 않는다.

## Responsive/accessibility

375/768/1024/1440px 검증. PC nav + main + right evidence; 모바일 single column/nav drawer/evidence bottom sheet 또는 full-screen panel. 표는 원본 헤더/값을 유지하고 table container 내부 가로 스크롤 허용, 전체 페이지 overflow 금지. 모바일 record detail도 제공하고 컬럼을 몰래 생략하지 않는다.

키보드로 파일 선택/실행/검토/다운로드 가능. modal focus trap/복귀, visible focus, semantic table/aria-sort, 아이콘 accessible name, 편리한 44px touch, 200% zoom, screen reader. SSE update는 focus 이동 없이 polite 상태 통지. hover/color-only 금지. 상태/오류별 재시도 대신 수동 action을 명확히 표시한다.

지원 QA: 최신 안정 Chrome/Edge/Firefox desktop, macOS Safari, iOS Safari, Android Chrome의 핵심 웹 흐름. push는 기능 감지/권한 기반이며 iOS 홈 화면 추가가 필요한 경우 안내한다. 구형 브라우저까지 동일 기능을 보장하지 않는다. 실제 기기 수동 QA와 Playwright 결과를 구분한다. 데스크톱/네이티브 앱 구현은 범위 밖이다.
