@call "%VCVARS_PATH%"
@if errorlevel 1 exit /b %errorlevel%
@%*
@exit /b %errorlevel%
