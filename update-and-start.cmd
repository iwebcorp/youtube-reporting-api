@echo off
REM 최신 소스를 받은 뒤 의존성을 맞추고 월별 정산 화면을 실행하는 파일
cd /d "%~dp0"
git pull --ff-only
if errorlevel 1 (
  echo [오류] 최신 소스를 받지 못했습니다. 아이웹에 문의해 주세요.
  pause
  exit /b 1
)
call npm.cmd ci
if errorlevel 1 (
  echo [오류] 프로그램 업데이트에 실패했습니다.
  pause
  exit /b 1
)
call start-gui.cmd
