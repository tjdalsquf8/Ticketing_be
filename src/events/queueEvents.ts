import { EventEmitter } from "events";
import type { SeatContextType } from "./seatEvents";

/**
 * 대기열 순번 변경을 SSE 구독자에게 중계하는 프로세스 내 이벤트 버스.
 *
 * 좌석(seatEvents)과 달리 payload 자체엔 순번을 담지 않는다 — 순번은 세션마다
 * 다르게 계산되는 값이라(내 앞에 몇 명 남았는지), "이 회차/이벤트 대기열에 변화가
 * 생겼다"는 신호만 흘려보내고, 구독 중인 각 SSE 커넥션이 자기 세션 기준으로
 * getQueueStatus() 를 다시 호출해 본인 순번을 계산한다.
 */

export interface QueueChangedPayload {
  contextType: SeatContextType;
  contextId: number;
}

class QueueEventEmitter extends EventEmitter {}

export const queueEvents = new QueueEventEmitter();
queueEvents.setMaxListeners(0);

export function queueChannel(contextType: SeatContextType, contextId: number): string {
  return `queue:${contextType}:${contextId}`;
}

export function emitQueueChanged(payload: QueueChangedPayload): void {
  queueEvents.emit(queueChannel(payload.contextType, payload.contextId), payload);
}
