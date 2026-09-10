import { Response } from "express";
import config from "../config";

const GUEST_UUID_COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;

/**
 * `guest_uuid` 쿠키를 심는 단일 진입점.
 *
 * 예전에는 guests.controller 와 practice.controller 가 각자 같은 이름의 헬퍼를
 * 들고 있었고 sameSite 값이 lax / strict 로 갈려 있었다. 같은 쿠키를 두 곳에서
 * 서로 다른 속성으로 덮어쓰면 나중에 호출된 쪽 정책이 이기므로, 속성이 조용히
 * 약해지는 걸 막으려면 정의가 한 곳이어야 한다.
 *
 * sameSite=strict 인 이유: lax 면 cross-site top-level POST(공격자 페이지의
 * 자동 제출 form)에 쿠키가 실리지 않아 서버가 "쿠키 없는 신규 게스트"로 판단하고
 * 새 UUID 를 Set-Cookie 로 피해자 브라우저에 덮어쓴다. 게스트 신원이 교체되면
 * 누적 이력과 연결이 끊기고, 라이브 회차 진행 중이라면 활성 세션 소유권 검사가
 * guest_uuid 기준이라 좌석 hold/confirm 이 실패한다.
 */
export const setGuestCookie = (res: Response, guestUuid: string): void => {
  res.cookie("guest_uuid", guestUuid, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    maxAge: GUEST_UUID_COOKIE_MAX_AGE,
    path: "/",
  });
};
