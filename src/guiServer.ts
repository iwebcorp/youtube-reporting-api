// 월별 정산 단계를 브라우저에서 실행하고 로그를 전달하는 로컬 서버
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { spawn, type ChildProcess } from "child_process";
import { getMonthlyReadiness, isValidYearMonth } from "./monthlyReadiness.js";
import { fillBlankCustomIds, listBlankCustomIdAssets } from "./packageCustomIds.js";

// 4단계 Custom ID 입력은 실행 단계가 아니라 /api/custom-ids로 처리한다.
type SettlementStep = "raw" | "managed" | "extract" | "settle";
type RunState = {
  running: boolean;
  yearMonth: string | null;
  steps: SettlementStep[];
  startedAt: string | null;
  exitCode: number | null;
  error: string | null;
};

const HOST = "127.0.0.1";
const DEFAULT_PORT = 43127;
const ALL_STEPS: SettlementStep[] = ["raw", "managed", "extract", "settle"];
const UI_FILES: Record<string, { file: string; contentType: string }> = {
  "/": { file: "ui/index.html", contentType: "text/html; charset=utf-8" },
  "/app.js": { file: "ui/app.js", contentType: "text/javascript; charset=utf-8" },
  "/style.css": { file: "ui/style.css", contentType: "text/css; charset=utf-8" },
  "/favicon.ico": { file: "public/favicon.ico", contentType: "image/x-icon" },
};
const LOG_LIMIT = 1_500;

let child: ChildProcess | null = null;
let logs: string[] = [];
let state: RunState = {
  running: false,
  yearMonth: null,
  steps: [],
  startedAt: null,
  exitCode: null,
  error: null,
};
const eventClients = new Set<http.ServerResponse>();

function parsePort(argv: string[]): number {
  const argument = argv.find((value) => value.startsWith("--port="));
  const port = Number(argument?.slice("--port=".length) ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${String(port)}`);
  }
  return port;
}

function sendJson(response: http.ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendEvent(response: http.ServerResponse, event: string, value: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

function broadcast(event: string, value: unknown): void {
  for (const response of eventClients) sendEvent(response, event, value);
}

function updateState(nextState: Partial<RunState>): void {
  state = { ...state, ...nextState };
  broadcast("state", state);
}

function appendLog(text: string): void {
  const sanitizedText = text
    .replace(/1\/\/[A-Za-z0-9_-]+/g, "<REDACTED_REFRESH_TOKEN>")
    .replace(/('refresh_token'\s*=>\s*)'[^']+'/g, "$1'<REDACTED>'")
    .replace(/("refresh_token"\s*:\s*)"[^"]+"/g, '$1"<REDACTED>"');
  const lines = sanitizedText.replace(/\r/g, "").split("\n").filter((line) => line.length > 0);
  for (const line of lines) {
    logs.push(line);
    broadcast("log", line);
  }
  if (logs.length > LOG_LIMIT) logs = logs.slice(-LOG_LIMIT);
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 64 * 1024) throw new Error("Request body is too large.");
  }
  return body ? JSON.parse(body) : {};
}

function normalizeSteps(value: unknown): SettlementStep[] {
  if (!Array.isArray(value)) throw new Error("steps must be an array.");
  const steps = value.filter((step): step is SettlementStep =>
    typeof step === "string" && ALL_STEPS.includes(step as SettlementStep),
  );
  if (steps.length !== value.length || steps.length === 0) {
    throw new Error("Select at least one valid stage.");
  }
  return ALL_STEPS.filter((step) => steps.includes(step));
}

function normalizeExchangeRate(value: unknown, steps: SettlementStep[]): string {
  const exchangeRate = typeof value === "string" ? value.replace(/,/g, "").trim() : "";
  if (!steps.includes("settle")) return "";
  if (!/^\d+(\.\d+)?$/.test(exchangeRate) || Number(exchangeRate) <= 0) {
    throw new Error("정산금 계산에 사용할 환율(원/USD)을 숫자로 입력해 주세요.");
  }
  return exchangeRate;
}

function resolveRunSteps(yearMonth: string, selected: SettlementStep[]): SettlementStep[] {
  if (!selected.includes("extract") && !selected.includes("settle")) return selected;
  const readiness = getMonthlyReadiness(yearMonth);
  const required = new Set(selected);
  if (selected.includes("settle") && !readiness.extract.ready) required.add("extract");
  if (!required.has("extract")) return ALL_STEPS.filter((step) => required.has(step));
  if (!readiness.raw.ready) required.add("raw");
  if (!readiness.managed.ready) required.add("managed");
  return ALL_STEPS.filter((step) => required.has(step));
}

function startRun(yearMonth: string, selectedSteps: SettlementStep[], exchangeRate: string): SettlementStep[] {
  if (child) throw new Error("Another monthly job is already running.");
  const steps = resolveRunSteps(yearMonth, selectedSteps);
  const tsxCliPath = path.resolve("node_modules", "tsx", "dist", "cli.mjs");
  if (!fs.existsSync(tsxCliPath)) {
    throw new Error("프로그램 구성 파일이 없습니다. setup-client.cmd를 먼저 실행해 주세요.");
  }
  logs = [];
  updateState({
    running: true,
    yearMonth,
    steps,
    startedAt: new Date().toISOString(),
    exitCode: null,
    error: null,
  });
  appendLog(`[GUI] ${yearMonth} 실행 시작. 단계: ${steps.join(", ")}`);

  const runner = spawn(
    process.execPath,
    [
      "--max-old-space-size=8192",
      tsxCliPath,
      "src/runMonthlySettlement.ts",
      `--yearMonth=${yearMonth}`,
      `--steps=${steps.join(",")}`,
      ...(exchangeRate ? [`--exchangeRate=${exchangeRate}`] : []),
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  child = runner;
  runner.stdout.on("data", (chunk: Buffer) => appendLog(chunk.toString()));
  runner.stderr.on("data", (chunk: Buffer) => appendLog(chunk.toString()));
  runner.once("error", (error) => {
    appendLog(`[GUI] 실행 오류: ${error.message}`);
    updateState({ error: error.message });
  });
  runner.once("close", (code) => {
    const exitCode = code ?? 1;
    appendLog(exitCode === 0 ? "[GUI] 선택한 작업이 완료되었습니다." : `[GUI] 작업이 중단되었습니다. exitCode=${exitCode}`);
    if (child === runner) child = null;
    updateState({ running: false, exitCode, error: exitCode === 0 ? null : `exitCode=${exitCode}` });
  });
  return steps;
}

function stopRun(): void {
  if (!child?.pid) return;
  const processToStop = child;
  appendLog("[GUI] 중지 요청을 보냈습니다.");
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(processToStop.pid), "/T", "/F"], { windowsHide: true });
  } else {
    processToStop.kill("SIGTERM");
  }
}

function openPath(targetPath: string): void {
  const absolutePath = path.resolve(targetPath);
  if (process.platform === "win32") {
    spawn("explorer.exe", [absolutePath], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [absolutePath], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [absolutePath], { detached: true, stdio: "ignore" }).unref();
  }
}

function openBrowser(url: string): void {
  if (process.platform === "win32") {
    spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${HOST}`);
  const staticFile = UI_FILES[url.pathname];
  if (request.method === "GET" && staticFile) {
    const filePath = path.resolve(staticFile.file);
    response.writeHead(200, { "Content-Type": staticFile.contentType, "Cache-Control": "no-store" });
    fs.createReadStream(filePath).pipe(response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    const yearMonth = url.searchParams.get("yearMonth") ?? "";
    if (!isValidYearMonth(yearMonth)) {
      sendJson(response, 400, { error: "yearMonth must use YYYYMM." });
      return;
    }
    sendJson(response, 200, { readiness: getMonthlyReadiness(yearMonth), run: state });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    eventClients.add(response);
    sendEvent(response, "state", state);
    for (const line of logs) sendEvent(response, "log", line);
    request.once("close", () => eventClients.delete(response));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/run") {
    if (child) {
      sendJson(response, 409, { error: "Another monthly job is already running." });
      return;
    }
    const body = await readJsonBody(request) as { yearMonth?: unknown; steps?: unknown; exchangeRate?: unknown };
    const yearMonth = typeof body.yearMonth === "string" ? body.yearMonth : "";
    if (!isValidYearMonth(yearMonth)) {
      sendJson(response, 400, { error: "yearMonth must use YYYYMM." });
      return;
    }
    const selectedSteps = normalizeSteps(body.steps);
    const steps = startRun(yearMonth, selectedSteps, normalizeExchangeRate(body.exchangeRate, selectedSteps));
    sendJson(response, 202, { steps });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/stop") {
    stopRun();
    sendJson(response, 200, { stopping: Boolean(child) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/open-output") {
    const body = await readJsonBody(request) as { yearMonth?: unknown };
    const yearMonth = typeof body.yearMonth === "string" ? body.yearMonth : "";
    if (!isValidYearMonth(yearMonth)) {
      sendJson(response, 400, { error: "yearMonth must use YYYYMM." });
      return;
    }
    const readiness = getMonthlyReadiness(yearMonth);
    openPath(fs.existsSync(readiness.paths.packageDir) ? readiness.paths.packageDir : process.cwd());
    sendJson(response, 200, { opened: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/open-settlement") {
    const body = await readJsonBody(request) as { yearMonth?: unknown };
    const yearMonth = typeof body.yearMonth === "string" ? body.yearMonth : "";
    if (!isValidYearMonth(yearMonth)) {
      sendJson(response, 400, { error: "yearMonth must use YYYYMM." });
      return;
    }
    const { settlementDir } = getMonthlyReadiness(yearMonth).paths;
    if (!fs.existsSync(settlementDir)) {
      sendJson(response, 404, { error: "정산금 계산 결과가 아직 없습니다." });
      return;
    }
    openPath(settlementDir);
    sendJson(response, 200, { opened: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/custom-ids") {
    const yearMonth = url.searchParams.get("yearMonth") ?? "";
    if (!isValidYearMonth(yearMonth)) {
      sendJson(response, 400, { error: "yearMonth must use YYYYMM." });
      return;
    }
    sendJson(response, 200, { assets: listBlankCustomIdAssets(yearMonth) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/custom-ids") {
    // 실행 중인 단계가 정산 파일을 다시 쓰는 중일 수 있어 그동안은 받지 않는다.
    if (child) {
      sendJson(response, 409, { error: "실행 중인 작업이 끝난 뒤 Custom ID를 저장해 주세요." });
      return;
    }
    const body = await readJsonBody(request) as { yearMonth?: unknown; values?: unknown };
    const yearMonth = typeof body.yearMonth === "string" ? body.yearMonth : "";
    if (!isValidYearMonth(yearMonth)) {
      sendJson(response, 400, { error: "yearMonth must use YYYYMM." });
      return;
    }
    if (!body.values || typeof body.values !== "object" || Array.isArray(body.values)) {
      sendJson(response, 400, { error: "values must be an object." });
      return;
    }
    const result = await fillBlankCustomIds(yearMonth, body.values as Record<string, unknown>);
    appendLog(`[GUI] ${yearMonth} Custom ID ${result.filledAssets}개 자산, ${result.filledRows}행을 정산 파일에 입력했습니다. 남은 공란 ${result.remainingRows}행`);
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/open-custom-id") {
    const body = await readJsonBody(request) as { yearMonth?: unknown };
    const yearMonth = typeof body.yearMonth === "string" ? body.yearMonth : "";
    if (!isValidYearMonth(yearMonth)) {
      sendJson(response, 400, { error: "yearMonth must use YYYYMM." });
      return;
    }
    const warning = getMonthlyReadiness(yearMonth).customIdWarning;
    if (!warning) {
      sendJson(response, 404, { error: "Custom ID 확인 목록이 없습니다." });
      return;
    }
    openPath(warning.filePath);
    sendJson(response, 200, { opened: true });
    return;
  }

  sendJson(response, 404, { error: "Not found." });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const port = parsePort(argv);
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 400, { error: message });
    });
  });
  server.listen(port, HOST, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    const url = `http://${HOST}:${actualPort}`;
    console.log(`[GUI] ${url}`);
    if (!argv.includes("--no-open")) openBrowser(url);
  });
}

main().catch((error) => {
  console.error("[GUI] Server failed.", error);
  process.exitCode = 1;
});
