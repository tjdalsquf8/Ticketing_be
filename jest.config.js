/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.(t|j)s$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", decorators: false },
          target: "es2022",
        },
      },
    ],
  },
  testTimeout: 15000,
  // 크론/pool 등 open handle 있어도 강제 종료
  forceExit: true,
  detectOpenHandles: false,
  // 테스트 간 rate limiter 영향 최소화를 위해 직렬 실행
  maxWorkers: 1,
  // watchman 권한 이슈 회피 (macOS 사용자 홈 권한 문제)
  watchman: false,
  haste: { enableSymlinks: false, forceNodeFilesystemAPI: true },
};
