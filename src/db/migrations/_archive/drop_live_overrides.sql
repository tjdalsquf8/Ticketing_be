-- 사용하지 않는 예외 스케줄 테이블 제거
-- 관리자 UI는 회차 개별 중지(cancel) 방식으로 변경됨
DROP TABLE IF EXISTS live_overrides;
