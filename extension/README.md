# YT Concert Live Extension Draft

현재 탭의 오디오를 캡처해서 콘서트홀 스타일로 가공한 뒤 다시 출력하는 크롬 확장프로그램 초안입니다.

## 구조

- `manifest.json`: MV3 확장 진입점
- `src/background.js`: 세션 상태 관리, 탭 캡처 시작/중지, offscreen 문서 생성
- `src/offscreen/controller.js`: 캡처된 `MediaStream` 수신 및 오디오 엔진 구동
- `src/offscreen/audio/*`: 스트림용 오디오 엔진 모듈
- `src/popup/*`: 사용자 제어 UI
- `src/lib/presets.js`: 공연장/청취 위치 프리셋과 기본값

## 로드 방법

1. 크롬에서 `chrome://extensions`를 엽니다.
2. `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드합니다`를 누릅니다.
4. 이 저장소의 `extension` 폴더를 선택합니다.

## 지금 되는 것

- 현재 활성 탭 기준 오디오 캡처 시작/중지
- 오프스크린 문서에서 실시간 Web Audio 처리
- 공간 프리셋, 청취 위치, 트랙 수, 앙상블 볼륨, 볼륨 감쇠, 딜레이, 울림 강도, 확산, 보조 반사, 피크 억제 조정
- 팝업 UI에서 설정 변경 시 실시간 반영

## 다음 단계 추천

- `AudioWorklet` 기반 커스텀 프로세서로 지연과 안정성 개선
- 탭 전환/재클릭 UX 다듬기
- YouTube 도메인에서만 노출되는 content script와 상태 배지 추가
- 세션 재연결, 에러 복구, mute/bypass 단축 버튼 추가
- 기존 `.backup/app/static/audio/*.js`의 더 정교한 공간 연출 로직 선택 이식
