// 월 선택과 단계 실행 및 실시간 로그 표시를 담당하는 브라우저 코드
const monthInput = document.querySelector("#yearMonth");
const runButton = document.querySelector("#runButton");
const stopButton = document.querySelector("#stopButton");
const openButton = document.querySelector("#openButton");
const openSettlementButton = document.querySelector("#openSettlementButton");
const rateControl = document.querySelector("#rateControl");
const exchangeRateInput = document.querySelector("#exchangeRate");
const clearButton = document.querySelector("#clearButton");
const logOutput = document.querySelector("#logOutput");
const notice = document.querySelector("#notice");
const runBadge = document.querySelector("#runBadge");
const customIdWarning = document.querySelector("#customIdWarning");
const customIdWarningText = document.querySelector("#customIdWarningText");
const openCustomIdButton = document.querySelector("#openCustomIdButton");
const stageInputs = [...document.querySelectorAll('.stage-row input[type="checkbox"]')];
let readiness = null;
let runState = { running: false };

function previousMonth() {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function compactMonth() {
  return monthInput.value.replace("-", "");
}

function selectedSteps() {
  return stageInputs.filter((input) => input.checked).map((input) => input.value);
}

function setStatus(stage, text, kind) {
  const status = document.querySelector(`[data-stage="${stage}"] .stage-status`);
  status.textContent = text;
  status.className = `stage-status ${kind}`;
}

function renderReadiness() {
  if (!readiness) return;
  setStatus("raw", readiness.raw.ready ? `준비 완료 ${readiness.raw.present}/${readiness.raw.expected}` : `${readiness.raw.present}/${readiness.raw.expected}`, readiness.raw.ready ? "ready" : "missing");
  setStatus("managed", readiness.managed.ready ? `준비 완료 ${readiness.managed.present}/${readiness.managed.expected}` : `${readiness.managed.present}/${readiness.managed.expected}`, readiness.managed.ready ? "ready" : "missing");
  setStatus("extract", readiness.extract.ready ? `생성 완료 ${readiness.extract.present}/${readiness.extract.expected}` : "생성 필요", readiness.extract.ready ? "ready" : "waiting");
  setStatus("settle", readiness.settle.ready ? `계산 완료 ${readiness.settle.present}/${readiness.settle.expected}` : "계산 필요", readiness.settle.ready ? "ready" : "waiting");

  const warning = readiness.customIdWarning;
  customIdWarning.hidden = !warning;
  if (warning) {
    const messages = [];
    if (warning.blankRows > 0) {
      messages.push(`Custom ID 공란 ${warning.blankRows}행(자산 ${warning.blankAssets}개)은 YouTube CMS에 등록된 값이 없어 API로 받을 수 없습니다. 목록의 파일·행·열 위치에 직접 입력해 주세요.`);
    }
    if (warning.noteRows > 0) {
      messages.push(`참고: CMS에 Custom ID가 여러 개 등록된 곡 ${warning.noteAssets}개는 정산 보고서 값을 사용했습니다. CMS 정리가 필요한지 목록에서 확인해 주세요.`);
    }
    customIdWarningText.textContent = messages.join(" ");
  }
}

function renderRunState() {
  runBadge.textContent = runState.running ? "실행 중" : runState.exitCode === 0 ? "완료" : runState.exitCode ? "오류" : "대기 중";
  runBadge.className = `run-badge ${runState.running ? "running" : runState.exitCode === 0 ? "complete" : runState.exitCode ? "error" : "idle"}`;
  runButton.disabled = runState.running;
  stopButton.disabled = !runState.running;
  monthInput.disabled = runState.running;
  stageInputs.forEach((input) => { input.disabled = runState.running; });
  exchangeRateInput.disabled = runState.running;
}

function enforceExtractPrerequisites() {
  const extract = stageInputs.find((input) => input.value === "extract");
  const settle = stageInputs.find((input) => input.value === "settle");
  if (!readiness) return;
  const added = [];
  if (settle.checked && !readiness.extract.ready && !extract.checked) {
    extract.checked = true;
    added.push("정산 파일 추출");
  }
  if (!extract.checked) {
    notice.textContent = added.length > 0 ? `선행 단계가 자동 선택되었습니다. ${added.join(", ")}` : "";
    return;
  }
  for (const stage of ["raw", "managed"]) {
    if (!readiness[stage].ready) {
      const input = stageInputs.find((candidate) => candidate.value === stage);
      if (!input.checked) added.push(stage === "raw" ? "Raw Data" : "System-managed Data");
      input.checked = true;
    }
  }
  notice.textContent = added.length > 0 ? `선행 단계가 자동 선택되었습니다. ${added.join(", ")}` : "";
}

async function refreshStatus() {
  if (!monthInput.value) return;
  try {
    const response = await fetch(`/api/status?yearMonth=${compactMonth()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    readiness = data.readiness;
    runState = data.run;
    renderReadiness();
    renderRunState();
    enforceExtractPrerequisites();
  } catch (error) {
    notice.textContent = error.message;
  }
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

monthInput.addEventListener("change", () => {
  notice.textContent = "";
  refreshStatus();
});

stageInputs.forEach((input) => input.addEventListener("change", () => {
  enforceExtractPrerequisites();
  if (!input.checked && ["raw", "managed", "extract"].includes(input.value)) enforceExtractPrerequisites();
}));

// 환율 칸 주변 글자를 눌러도 단계 체크가 바뀌지 않게 하고, 환율을 입력하면 정산금 계산 단계를 선택한다.
rateControl.addEventListener("click", (event) => {
  if (event.target === exchangeRateInput) return;
  event.preventDefault();
  exchangeRateInput.focus();
});
exchangeRateInput.addEventListener("input", () => {
  const settle = stageInputs.find((input) => input.value === "settle");
  if (exchangeRateInput.value.trim() && !settle.checked) {
    settle.checked = true;
    enforceExtractPrerequisites();
  }
});

runButton.addEventListener("click", async () => {
  enforceExtractPrerequisites();
  const steps = selectedSteps();
  if (steps.length === 0) {
    notice.textContent = "실행할 단계를 하나 이상 선택해 주세요.";
    return;
  }
  const exchangeRate = exchangeRateInput.value.replace(/,/g, "").trim();
  if (steps.includes("settle") && !(/^\d+(\.\d+)?$/.test(exchangeRate) && Number(exchangeRate) > 0)) {
    notice.textContent = "정산금 계산에 사용할 환율(원/USD)을 숫자로 입력해 주세요.";
    exchangeRateInput.focus();
    return;
  }
  try {
    notice.textContent = "";
    logOutput.textContent = "";
    const data = await postJson("/api/run", { yearMonth: compactMonth(), steps, exchangeRate });
    for (const input of stageInputs) input.checked = data.steps.includes(input.value);
  } catch (error) {
    notice.textContent = error.message;
  }
});

stopButton.addEventListener("click", async () => {
  try {
    await postJson("/api/stop");
  } catch (error) {
    notice.textContent = error.message;
  }
});

openButton.addEventListener("click", async () => {
  try {
    await postJson("/api/open-output", { yearMonth: compactMonth() });
  } catch (error) {
    notice.textContent = error.message;
  }
});

openSettlementButton.addEventListener("click", async () => {
  try {
    await postJson("/api/open-settlement", { yearMonth: compactMonth() });
  } catch (error) {
    notice.textContent = error.message;
  }
});

openCustomIdButton.addEventListener("click", async () => {
  try {
    await postJson("/api/open-custom-id", { yearMonth: compactMonth() });
  } catch (error) {
    notice.textContent = error.message;
  }
});

clearButton.addEventListener("click", () => { logOutput.textContent = ""; });

const events = new EventSource("/api/events");
events.addEventListener("state", (event) => {
  runState = JSON.parse(event.data);
  renderRunState();
  if (!runState.running) refreshStatus();
});
events.addEventListener("log", (event) => {
  if (logOutput.textContent === "실행 대기 중입니다.") logOutput.textContent = "";
  logOutput.textContent += `${JSON.parse(event.data)}\n`;
  logOutput.scrollTop = logOutput.scrollHeight;
});

monthInput.value = previousMonth();
refreshStatus();
