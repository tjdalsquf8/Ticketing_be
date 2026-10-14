import { EventEmitter } from "events";

/**
 * 좌석 상태 변경을 SSE 구독자에게 중계하는 프로세스 내 이벤트 버스.
 * 단일 서버 전제(Redis 미도입) — 인스턴스 늘리면 pub/sub 으로 교체 필요.
 */

export type SeatContextType = "round" | "event";

export interface SeatEventPayload {
  seatLabel: string;
  status: "available" | "held" | "sold";
  contextType: SeatContextType;
  contextId: number;
}

class SeatEventEmitter extends EventEmitter {}

export const seatEvents = new SeatEventEmitter();
// 회차/이벤트당 동접 구독자가 10명을 넘는 게 정상이므로 기본 경고 제한을 해제한다.
seatEvents.setMaxListeners(0);

export function seatChannel(contextType: SeatContextType, contextId: number): string {
  return `seat:${contextType}:${contextId}`;
}

export function emitSeatUpdate(payload: SeatEventPayload): void {
  seatEvents.emit(seatChannel(payload.contextType, payload.contextId), payload);
}
