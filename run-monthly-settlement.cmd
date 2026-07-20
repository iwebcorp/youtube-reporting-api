@REM 월 입력만으로 월별 정산 자동 실행기를 시작하는 Windows 실행 파일
@echo off
cd /d "%~dp0"
npm.cmd run monthly-settlement
pause

