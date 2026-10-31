#requires -Version 7.0
param([Parameter(Mandatory)][string]$ModelRoot)
$ErrorActionPreference='Stop'
$lock=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'model-lock.json') | ConvertFrom-Json
$server=@(Get-ChildItem -LiteralPath (Join-Path $ModelRoot $lock.llama.tag) -Recurse -Filter llama-server.exe)
if($server.Count -ne 1){throw 'Expected one dedicated checked server path'}
$matching=@(Get-Process | Where-Object {$_.Path -eq $server[0].FullName})
if($matching.Count -gt 1){throw 'Multiple matches; inspect manually rather than stopping unrelated work'}
if($matching.Count -eq 1){Stop-Process -Id $matching[0].Id;Write-Output 'Stopped the dedicated model server'}else{Write-Output 'Dedicated model server is not running'}
