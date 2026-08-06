@echo off
REM 광수미디어 PC에서 최초 1회 의존성을 설치하고 월별 정산 화면을 실행하는 파일
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js LTS를 먼저 설치해 주세요.
  pause
  exit /b 1
)
if not exist credentials.json (
  echo [오류] 프로젝트 폴더에 credentials.json이 없습니다.
  echo 아이웹에서 전달받은 인증 파일을 넣은 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)
call npm.cmd ci
if errorlevel 1 (
  echo [오류] 프로그램 설치에 실패했습니다.
  pause
  exit /b 1
)
call start-gui.cmd
