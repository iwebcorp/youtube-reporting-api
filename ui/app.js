// 월 선택과 단계 실행 및 실시간 로그 표시를 담당하는 브라우저 코드
const monthInput = document.querySelector("#yearMonth");
const runButton = document.querySelector("#runButton");
const stopButton = document.querySelector("#stopButton");
const openButton = document.querySelector("#openButton");
const clearButton = document.querySelector("#clearButton");
const logOutput = document.querySelector("#logOutput");
const notice = document.querySelector("#notice");
const runBadge = document.querySelector("#runBadge");
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
}

function renderRunState() {
  runBadge.textContent = runState.running ? "실행 중" : runState.exitCode === 0 ? "완료" : runState.exitCode ? "오류" : "대기 중";
  runBadge.className = `run-badge ${runState.running ? "running" : runState.exitCode === 0 ? "complete" : runState.exitCode ? "error" : "idle"}`;
  runButton.disabled = runState.running;
  stopButton.disabled = !runState.running;
  monthInput.disabled = runState.running;
  stageInputs.forEach((input) => { input.disabled = runState.running; });
}

function enforceExtractPrerequisites() {
  const extract = stageInputs.find((input) => input.value === "extract");
  if (!extract.checked || !readiness) return;
  const added = [];
  for (const stage of ["raw", "managed"]) {
    if (!readiness[stage].ready) {
      const input = stageInputs.find((candidate) => candidate.value === stage);
      if (!input.checked) added.push(stage === "raw" ? "Raw Data" : "System-managed Data");
      input.checked = true;
    }
  }
  notice.textContent = added.length > 0 ? `추출 선행 단계가 자동 선택되었습니다. ${added.join(", ")}` : "";
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
  if (!input.checked && ["raw", "managed"].includes(input.value)) enforceExtractPrerequisites();
}));

runButton.addEventListener("click", async () => {
  enforceExtractPrerequisites();
  const steps = selectedSteps();
  if (steps.length === 0) {
    notice.textContent = "실행할 단계를 하나 이상 선택해 주세요.";
    return;
  }
  try {
    notice.textContent = "";
    logOutput.textContent = "";
    const data = await postJson("/api/run", { yearMonth: compactMonth(), steps });
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
