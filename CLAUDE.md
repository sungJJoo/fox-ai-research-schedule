# FOX AI 연구소 담당표

## 프로젝트 개요
3인 팀(윤승희/팀장, 박성주/연구원, 김기환/연구원)의 3주 순환 근무 담당표 웹 대시보드.

## 파일 구조
- `index.html` — 전체 프론트엔드 (CSS + HTML + JS 단일 파일)
- `apps-script.gs` — Google Apps Script 백엔드 백업 (실제 실행은 GAS 편집기)
- `CLAUDE.md` — 프로젝트 컨텍스트
- `.gitignore` — .claude/ 만 제외 (머신별 설정)

## 백엔드 (Google Apps Script)
URL: https://script.google.com/macros/s/AKfycbxpQ2gMHbwXmjfkQFeGCEDDbWL4I4zCwjP6eV7vwjpPPykmKZBslnJGPrSsTyoAtT3L/exec

### API 액션
- GET / — schedule, tasks, members, workSchedule, completedTasks, recurringTasks, v 반환
- GET ?action=getHash — { v: 버전 } 만 반환 (가벼운 변경 감지용 핑)
- GET ?action=setComplete&row=N&value=true/false — 업무 완료 토글 (F열 완료시각 포함)
- GET ?action=addTask&name=X&assignee=Y&deadline=YYYY-MM-DD&detail=Z — 업무 추가 (담당표 마지막 행+1에 삽입)
- GET ?action=updateTask&row=N&name=X&assignee=Y&deadline=YYYY-MM-DD&detail=Z — 업무 수정 (완료/완료시각은 유지)
- GET ?action=deleteTask&row=N — 업무 삭제
- GET ?action=addCompletedTask&name=X&assignee=Y&deadline=YYYY-MM-DD&detail=Z&completedAt=YYYY-MM-DDTHH:MM — 완료 업무 수동 추가
- GET ?action=addRecurringTask&name=X&assignee=Y&deadline=YYYY-MM-DD&detail=Z — 반복 업무 추가 (수동)
- GET ?action=updateRecurringTask&row=N&name=X&assignee=Y&deadline=YYYY-MM-DD&detail=Z — 반복 업무 수정
- GET ?action=deleteRecurringTask&row=N — 반복 업무 삭제
- GET ?action=setRecurringComplete&row=N&value=true/false — 반복 업무 완료 토글 (자동 아카이브 없음)
- GET ?action=addMember&name=X&role=Y&color=Z — 멤버 추가
- GET ?action=updateMember&original=X&name=Y&role=Z&color=W — 멤버 수정 + 담당표/근무일정/완료업무/반복업무 시트 자동 반영
- GET ?action=deleteMember&name=X — 멤버 삭제

### 반복 업무 시트
- 헤더: 업무|담당|마감기한|세부사항|완료|완료시각 (담당표와 동일 구조)
- 자동 삽입 X — 사용자가 수동 관리
- 완료 토글해도 자동 삭제 안 됨 (다음 회차에 수동으로 다시 해제)
- Apps Script가 없으면 자동 생성

### 성능 최적화
- **버전 카운터**: PropertiesService에 'v' 저장. 모든 mutation 액션이 bumpVersion()으로 갱신.
- **해시 폴링**: 30초마다 getHash로 v만 체크. v 변경 시에만 전체 GET. → 폴링 비용 80% 감소.
- **낙관적 UI**: 업무 추가/수정/삭제/완료업무 추가 시 즉시 로컬 캐시 갱신. 전체 GET 안 함.
- **GAS 워밍업**: 모달 열 때 fire-and-forget getHash 호출. 저장 시 콜드 스타트 회피.
- **preconnect**: <head>에 script.google.com 미리 연결.

## Google Sheets 구조
스프레드시트 ID: 1JqEEkUFPM2kVNhesqyEeXePtPhmFy9NIiOe0uga8R2w

### 담당표 탭
- A1:F4 — 3주 순환 스케줄 (헤더: 주차|월|화|수|목|금)
- A7:F — 업무 리스트 (헤더: AI연구소 업무|담당|마감기한|세부사항|완료|완료시각)
  - E열: 완료 (TRUE/FALSE)
  - F열: 완료시각 (yyyy-MM-dd HH:mm:ss 형식)

### 근무일정 탭
- 날짜행: A열 비어있음, B~G열에 M/D 형식 날짜
- 멤버행: A열에 이름, B~G열에 근무 정보
- 셀값 종류: 시간(예: 11:00-20:00), 휴무, 연차, 반차(오전), 반차(오후), 공휴일

### 멤버 탭
- 헤더: 이름|역할|색상
- 색상 슬롯: ysh(청록), psj(주황), kkh(회색), c4(보라), c5(파랑), c6(분홍), c7(에메랄드), c8(레드)
- Apps Script가 없으면 자동 생성 (기본 3명 포함)

### 완료 업무 탭
- 헤더: 업무|담당|마감기한|세부사항|완료시각
- Apps Script가 없으면 자동 생성
- cleanupCompleted 트리거가 30분 지난 완료 업무를 담당표에서 이 시트로 이동

## 핵심 로직
- 앵커 날짜: 2026-04-27 (1주차 월요일 기준, 3주 무한 반복)
- 완료 후 30분 경과 → 클라이언트 자동 숨김 + Apps Script 트리거로 '완료 업무' 시트에 아카이브 후 담당표에서 삭제
- 멤버 이름 변경 시 담당표·근무일정·완료업무 시트 자동 반영 (updateMember 액션)
- 완료 업무 리스트: 담당자/기간 필터, 마감기한 대비 타이밍 비교 배지(빠름/당일/지각)
- 카운트다운 배지: D-N(7일 이내), D-1/2(주황), TODAY(빨강), N일 지남(진빨강)
- 폴링: 30초 간격 자동 갱신, 모달 열려있거나 백그라운드 탭이면 스킵, 해시 비교로 변경 없으면 렌더 스킵
- 브라우저 알림: Notification API로 당일 마감 업무 알림, localStorage(`fox_notif_sent`)로 중복 방지
- 단축키: N(업무 추가 모달), Esc(모달 닫기)

## 색상 슬롯 CSS 변수
--ysh:#2e7d6e; --ysh-lt:#eaf4f1; --ysh-md:#a8d4cb;
--psj:#c05621; --psj-lt:#fdf0e8; --psj-md:#f0bfa0;
--kkh:#4a5568; --kkh-lt:#eef0f3; --kkh-md:#b0bac8;
c4~c8: 보라/파랑/분홍/에메랄드/레드