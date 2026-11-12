# 只结束测试进程：假 QQ，以及用 ~/.dsh 开发环境跑的大肥鱼。绝不碰安装目录里正在运行的实例。
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -match 'mock-onebot' -or ($_.CommandLine -match '--profile fish' -and $_.CommandLine -match '\.dsh[\\/]profiles')
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
