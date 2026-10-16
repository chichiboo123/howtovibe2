# 실습 1~4 예제 코드 모의 검증

사이트 `index.html`의 복사용 코드 블록(`#m1_gs` … `#m4_prompt`, 실습 1의 교사 대시보드 `#m1_dash`)을 **복사 버튼과 같은 방식(textContent)** 으로 꺼내 검사합니다.

```bash
cd tests/practices
npm install
npm test            # 사이트의 현재 코드
node run.cjs 다른/index.html   # 다른 버전 비교
```

- `test-server.cjs`, `test-ui.cjs` — 외부 검증보고서(기준 커밋 664b459)의 37항목 (실습 1은 한 학급·교사 대시보드 구조에 맞게 바꿈)
- `test-extra.cjs` — 시트 연결(SPREADSHEET_ID), flush 뒤 잠금 해제, 늦은 응답 버리기, 공감 요청 번호, 캐시 잠금·실패 처리, 같은 날 여러 글감, PDF 실패 안내, 실습 1 학생 화면의 학급 기록 비노출·대시보드 접근 제한 등 회귀 항목

**모의(mock) 환경입니다.** Google 시트 저장, 권한 승인, 잠금·캐시의 실제 동작, 문서/PDF 생성, 실제 위키백과 응답은 확인하지 않습니다. 실제 배포 점검은 따로 해야 합니다.
