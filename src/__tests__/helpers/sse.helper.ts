/**
 * SSE 테스트 헬퍼.
 *
 * 좌석 스트림(GET .../seats/stream)은 연결을 계속 유지하므로 supertest/superagent 의
 * 일반 await 패턴(`.end()` 가 응답 종료까지 기다림)을 쓸 수 없고, superagent 의
 * keep-alive 소켓 풀에서 중간에 소켓을 끊으면 같은 풀을 공유하는 무관한 테스트까지
 * "aborted" 에러로 전염된다. 그래서 supertest 를 거치지 않고, 이 헬퍼 전용의 독립된
 * 서버 인스턴스 + keep-alive 없는 소켓(raw http)으로 직접 붙는다.
 */

import http from "node:http";
import type { Express } from "express";
import type { AddressInfo } from "node:net";

interface SseReadResult {
  status: number;
  /** SSE 이벤트로 응답한 경우("event: ..." 프레임을 받은 경우)에만 존재 */
  event?: string;
  data?: unknown;
  /** 스트림 진입 전 일반 JSON 응답(에러 등)으로 끝난 경우에만 존재 */
  body?: unknown;
}

function readSseEvent(
  app: Express,
  path: string,
  headers: Record<string, string> = {},
  timeoutMs = 3000,
): Promise<SseReadResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      let settled = false;
      let buf = "";

      const req = http.get(
        { hostname: "127.0.0.1", port, path, headers, agent: false },
        (res) => {
          res.on("data", (chunk: Buffer) => {
            if (settled) return;
            buf += chunk.toString();
            const match = buf.match(/event: (\w+)\ndata: (.+)\n\n/);
            if (match) {
              finish({ status: res.statusCode!, event: match[1], data: JSON.parse(match[2]) });
            }
          });
          res.on("end", () => {
            if (settled) return;
            let body: unknown;
            try {
              body = JSON.parse(buf);
            } catch {
              body = undefined;
            }
            finish({ status: res.statusCode!, body });
          });
        },
      );
      req.on("error", () => {
        // finish() 가 req.destroy() 로 소켓을 끊을 때 발생하는 에러는 정상 흐름이라 무시.
      });

      // 서버 소켓·포트가 완전히 정리된 뒤에 resolve/reject 해야 다음 테스트가 fd/포트를
      // 안전하게 재사용할 수 있다. close() 콜백을 기다리지 않으면 드물게 뒤에 도는
      // 무관한 테스트에서 소켓 경합("socket hang up")이 발생했다.
      const teardown = (after: () => void): void => {
        req.destroy();
        server.closeAllConnections?.();
        server.close(after);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        teardown(() => reject(new Error("SSE 응답 대기 시간 초과")));
      }, timeoutMs);

      const finish = (result: SseReadResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        teardown(() => resolve(result));
      };
    });
  });
}

interface SseFrame {
  status: number;
  event: string;
  data: unknown;
}

interface SseStream {
  /** 다음 프레임을 기다린다. 이미 도착해 큐에 쌓여있으면 즉시 반환. */
  next(timeoutMs?: number): Promise<SseFrame>;
  /** 연결을 끊고 서버 소켓/포트를 정리한다(비동기 완료는 기다리지 않음). */
  close(): void;
}

/**
 * 연결을 유지한 채 여러 SSE 프레임을 순서대로 읽어야 하는 테스트용(예: 대기열
 * 순번 push — snapshot 받고, 서버 쪽 상태 변화를 트리거한 뒤, 뒤이은 push
 * 프레임을 검증). heartbeat 주석(`: ping\n\n`)은 프레임으로 파싱되지 않고
 * 조용히 건너뛴다.
 */
function openSseStream(
  app: Express,
  path: string,
  headers: Record<string, string> = {},
): SseStream {
  const server = http.createServer(app);
  let buf = "";
  let statusCode = 0;
  let closed = false;
  const frameQueue: { event: string; data: unknown }[] = [];
  const waiters: Array<(frame: { event: string; data: unknown } | null) => void> = [];

  const deliver = (frame: { event: string; data: unknown }): void => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter(frame);
    } else {
      frameQueue.push(frame);
    }
  };

  let req: http.ClientRequest;
  const ready = new Promise<void>((resolveReady) => {
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      req = http.get(
        { hostname: "127.0.0.1", port, path, headers, agent: false },
        (res) => {
          statusCode = res.statusCode!;
          resolveReady();
          res.on("data", (chunk: Buffer) => {
            buf += chunk.toString();
            let idx: number;
            while ((idx = buf.indexOf("\n\n")) !== -1) {
              const frameText = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const match = frameText.match(/^event: (\w+)\ndata: (.+)$/);
              if (match) {
                deliver({ event: match[1], data: JSON.parse(match[2]) });
              }
            }
          });
        },
      );
      req.on("error", () => {
        // close() 가 소켓을 끊을 때 발생하는 에러는 정상 흐름이라 무시.
      });
    });
  });

  const next = (timeoutMs = 3000): Promise<SseFrame> =>
    ready.then(
      () =>
        new Promise<SseFrame>((resolve, reject) => {
          const queued = frameQueue.shift();
          if (queued) {
            resolve({ status: statusCode, ...queued });
            return;
          }
          const timer = setTimeout(() => {
            const idx = waiters.indexOf(onFrame);
            if (idx !== -1) waiters.splice(idx, 1);
            reject(new Error("SSE 다음 이벤트 대기 시간 초과"));
          }, timeoutMs);
          const onFrame = (frame: { event: string; data: unknown } | null): void => {
            clearTimeout(timer);
            if (frame) resolve({ status: statusCode, ...frame });
            else reject(new Error("SSE 연결 종료"));
          };
          waiters.push(onFrame);
        }),
    );

  const close = (): void => {
    if (closed) return;
    closed = true;
    req?.destroy();
    server.closeAllConnections?.();
    server.close();
  };

  return { next, close };
}

/**
 * superagent Set-Cookie 응답 헤더 → 재요청에 쓸 "a=1; b=2" Cookie 헤더 문자열.
 * superagent 의 헤더 타입 선언은 string 이지만 실제 set-cookie 는 배열로 온다.
 */
function toCookieHeader(setCookie: string | string[] | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return values.map((c) => c.split(";")[0]).join("; ");
}

export { readSseEvent, openSseStream, toCookieHeader };
