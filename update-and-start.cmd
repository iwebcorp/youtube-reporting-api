@echo off
chcp 65001 >nul
setlocal
REM 최신 소스를 받은 뒤 의존성을 맞추고 월별 정산 화면을 실행하는 파일
cd /d "%~dp0"
git pull --ff-only
if errorlevel 1 goto update_failed
call npm.cmd ci
if errorlevel 1 goto install_failed
call start-gui.cmd
exit /b %errorlevel%

:update_failed
echo [오류] 최신 소스를 받지 못했습니다. 아이웹에 문의해 주세요.
goto failed

:install_failed
echo [오류] 프로그램 업데이트에 실패했습니다.

:failed
pause
exit /b 1
