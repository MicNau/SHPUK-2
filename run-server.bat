@echo off
rem Запуск dev-сервера SHPUK (раздаёт сайт + прокси к каталогу sollersdev.ru).
rem Двойной клик по этому файлу запускает сервер. Закрыть окно = остановить сервер.
cd /d "%~dp0"
echo.
echo  Запуск SHPUK dev-сервера...
echo  Откройте в браузере:  http://localhost:8848
echo  Остановить: закройте это окно или нажмите Ctrl+C
echo.
python "%~dp0devserver.py" 8848
echo.
echo  Сервер остановлен.
pause
