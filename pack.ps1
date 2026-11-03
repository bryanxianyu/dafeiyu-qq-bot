# 大肥鱼打包工具：生成开箱即用的 zip（内置 Node、精简版 DSH、插件、NapCat 一键包）
#   pwsh ./pack.ps1                 用 plugin/package.json 里的版本
#   pwsh ./pack.ps1 -Bump           补丁版本 +1 再打包
#   pwsh ./pack.ps1 -DshVersion x   指定内置的 DSH 版本（换版本后记得用 test/ 里的脚本回归一遍）
#   pwsh ./pack.ps1 -Refresh        丢掉缓存，重新下载 DSH / NapCat
param(
    [switch]$Bump,
    [string]$DshVersion = '0.2.1-rc.5',
    [switch]$Refresh
)
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Cache = Join-Path $Root '.build-cache'
New-Item -ItemType Directory -Force $Cache | Out-Null
function Step($msg) { Write-Host "▶ $msg" -ForegroundColor Cyan }

# 某些 DSH 版本里有大量重复嵌套的依赖，在根上钉住版本让 npm 提升到顶层（0.2.1-rc.5 的 zod 能省 160MB）
$Pins = @{ '0.2.1-rc.5' = @{ 'zod' = '4.4.3' } }

# ---------- 版本 ----------
$pkgPath = Join-Path $Root 'plugin\package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
if ($Bump) {
    $v = [version]$pkg.version
    $pkg.version = "$($v.Major).$($v.Minor).$($v.Build + 1)"
    (Get-Content $pkgPath -Raw) -replace '"version":\s*"[^"]+"', "`"version`": `"$($pkg.version)`"" | Set-Content $pkgPath -NoNewline -Encoding utf8NoBOM
}
$version = $pkg.version
Step "大肥鱼 v$version（DSH $DshVersion）"

foreach ($f in @(Get-ChildItem (Join-Path $Root 'plugin\lib') -Filter *.js) + @(Get-ChildItem (Join-Path $Root 'release\app'), (Join-Path $Root 'release\extensions') -Recurse -Include *.mjs, *.js)) {
    node --check $f.FullName
    if ($LASTEXITCODE -ne 0) { throw "语法错误：$($f.Name)" }
}

# ---------- Node 运行时 ----------
$nodeExe = (Get-Command node).Source
$nodeVer = [version]((node -v).TrimStart('v'))
if ($nodeVer.Major -lt 24 -and -not ($nodeVer.Major -eq 22 -and $nodeVer.Minor -ge 19)) { throw "本机 Node $nodeVer 太旧，DSH 需要 22.19+ / 24+" }

# ---------- DSH：安装 → 按 fish profile 精简（都有缓存） ----------
$dshFull = Join-Path $Cache "dsh-$DshVersion"
$dshPruned = Join-Path $Cache "dsh-$DshVersion-pruned"
if ($Refresh) { Remove-Item -Recurse -Force $dshFull, $dshPruned -ErrorAction SilentlyContinue }
if (-not (Test-Path "$dshFull\node_modules\@deepseek-ai\dsh")) {
    Step "下载 DSH $DshVersion"
    New-Item -ItemType Directory -Force $dshFull | Out-Null
    $deps = [ordered]@{ '@deepseek-ai/dsh' = $DshVersion }
    if ($Pins[$DshVersion]) { foreach ($k in $Pins[$DshVersion].Keys) { $deps[$k] = $Pins[$DshVersion][$k] } }
    @{ name = 'fish-runtime'; private = $true; dependencies = $deps } | ConvertTo-Json | Set-Content "$dshFull\package.json" -Encoding utf8NoBOM
    Push-Location $dshFull; npm install --no-audit --no-fund; $code = $LASTEXITCODE; Pop-Location
    if ($code -ne 0) { throw 'npm install 失败' }
}
if (-not (Test-Path "$dshPruned\node_modules\@deepseek-ai\dsh")) {
    Step '精简 DSH（只保留 fish profile 用到的部分）'
    $probe = Join-Path $Cache 'probe-home'
    Remove-Item -Recurse -Force $probe -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force "$probe\profiles\fish\node_modules\dsh-fish" | Out-Null
    Copy-Item "$Root\plugin\*" "$probe\profiles\fish\node_modules\dsh-fish" -Recurse
    Copy-Item "$Root\release\profile\package.json" "$probe\profiles\fish\package.json"
    $env:DSH_HOME = $probe
    node "$dshFull\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile fish --dump-config | Set-Content "$Cache\dump.yml" -Encoding utf8NoBOM
    Remove-Item Env:DSH_HOME
    Remove-Item -Recurse -Force $dshPruned -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $dshPruned | Out-Null
    Copy-Item "$dshFull\node_modules" $dshPruned -Recurse
    node "$Root\build\prune.mjs" "$dshPruned\node_modules" "$Cache\dump.yml" '@deepseek-ai/dsh-base' '@deepseek-ai/schemastery' '@deepseek-ai/dsh-agent' '@deepseek-ai/dsh-llm'
    if ($LASTEXITCODE -ne 0) { throw '精简失败' }
}

# ---------- NapCat 一键包 ----------
$napcatCache = Join-Path $Cache 'napcat'
if ($Refresh) { Remove-Item -Recurse -Force $napcatCache -ErrorAction SilentlyContinue }
if (-not (Test-Path "$napcatCache\onekey\NapCatInstaller.exe")) {
    Step '下载 NapCat 一键包'
    New-Item -ItemType Directory -Force $napcatCache | Out-Null
    $rel = Invoke-RestMethod 'https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest'
    $asset = $rel.assets | Where-Object name -eq 'NapCat.Shell.Windows.OneKey.zip'
    Invoke-WebRequest $asset.browser_download_url -OutFile "$napcatCache\onekey.zip"
    Expand-Archive "$napcatCache\onekey.zip" "$napcatCache\onekey" -Force
    Invoke-WebRequest 'https://raw.githubusercontent.com/NapNeko/NapCatQQ/main/LICENSE' -OutFile "$napcatCache\LICENSE"
    Set-Content "$napcatCache\version.txt" $rel.tag_name
}
$napcatVersion = (Get-Content "$napcatCache\version.txt" -Raw).Trim()

# ---------- 组装 ----------
$name = "dafeiyu-v$version"
$stage = Join-Path $Root "dist\$name"
Step "组装 $stage"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force "$stage\runtime\dsh", "$stage\home\profiles\fish\node_modules\dsh-fish", "$stage\app", "$stage\napcat", "$stage\data" | Out-Null

Copy-Item $nodeExe "$stage\runtime\node.exe"
$nodeLicense = Join-Path (Split-Path $nodeExe) 'LICENSE'
if (Test-Path $nodeLicense) { Copy-Item $nodeLicense "$stage\runtime\LICENSE-node.txt" }
Copy-Item "$dshPruned\node_modules" "$stage\runtime\dsh" -Recurse
Copy-Item "$Root\plugin\*" "$stage\home\profiles\fish\node_modules\dsh-fish" -Recurse
Copy-Item "$Root\release\profile\package.json" "$stage\home\profiles\fish\package.json"
Copy-Item "$napcatCache\onekey\*" "$stage\napcat" -Recurse
Copy-Item "$napcatCache\LICENSE" "$stage\napcat\LICENSE-NapCat.txt"
Set-Content "$stage\napcat\来源说明.txt" @"
本目录为 NapCatQQ $napcatVersion 的 Windows 一键包（NapCat.Shell.Windows.OneKey），未经修改。
项目地址：https://github.com/NapNeko/NapCatQQ
版权所有 © Mlikiowa，按 LICENSE-NapCat.txt（Limited Redistribution License）再分发，禁止商用。
首次启动时 NapCatInstaller.exe 会从腾讯官方 CDN 下载 QQ。
"@ -Encoding utf8

# 控制台（网页 GUI + 进程管理）与扩展模板
Copy-Item "$Root\release\app\*" "$stage\app" -Recurse
Copy-Item "$Root\release\extensions" "$stage\app\extensions" -Recurse
$bom = New-Object System.Text.UTF8Encoding $true
$readme = (Get-Content "$Root\release\使用说明.txt" -Raw).Replace('__FISH_VERSION__', $version).Replace('__DSH_VERSION__', $DshVersion).Replace('__NAPCAT_VERSION__', $napcatVersion)
[IO.File]::WriteAllText("$stage\使用说明.txt", $readme.Replace("`r`n", "`n").Replace("`n", "`r`n"), $bom)

# ---------- exe：托盘启动器 + 安装程序（Windows 自带的 C# 编译器，无需额外工具） ----------
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$icon = Join-Path $Root 'build\fish.ico'
if (-not (Test-Path $icon)) { pwsh -NoProfile -File (Join-Path $Root 'build\make-icon.ps1') $icon | Out-Null }
Step '编译 大肥鱼.exe'
& $csc -nologo -optimize -target:winexe "-win32icon:$icon" -r:System.Windows.Forms.dll -r:System.Drawing.dll -r:System.Web.Extensions.dll "-out:$stage\大肥鱼.exe" (Join-Path $Root 'build\launcher.cs')
if ($LASTEXITCODE -ne 0) { throw '启动器编译失败' }

Step '压缩（便携版 zip，同时作为安装程序的载荷）'
$zip = Join-Path $Root "dist\$name-portable.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path "$stage\*" -DestinationPath $zip -CompressionLevel Optimal

Step '编译安装程序'
$work = Join-Path $Cache 'setup-build'
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $work | Out-Null
Copy-Item $zip "$work\payload.zip"
(Get-Content (Join-Path $Root 'build\setup.cs') -Raw).Replace('__VERSION__', $version) | Set-Content "$work\setup.cs" -Encoding utf8
$setup = Join-Path $Root "dist\大肥鱼-Setup-v$version.exe"
Push-Location $work
& $csc -nologo -optimize -target:winexe "-win32icon:$icon" -resource:payload.zip,payload.zip -r:System.Windows.Forms.dll -r:System.Drawing.dll -r:System.IO.Compression.dll -r:System.IO.Compression.FileSystem.dll -r:Microsoft.CSharp.dll -r:System.Core.dll "-out:$setup" setup.cs
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw '安装程序编译失败' }
Remove-Item -Recurse -Force $work

$mb = [math]::Round((Get-Item $setup).Length / 1MB)
$unpacked = [math]::Round(((Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB)
Write-Host "✅ 安装程序：$setup（$mb MB，安装后约 $unpacked MB）" -ForegroundColor Green
Write-Host "✅ 便携版：$zip" -ForegroundColor Green
