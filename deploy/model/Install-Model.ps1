#requires -Version 7.0
param([Parameter(Mandatory)][string]$ModelRoot)
$ErrorActionPreference='Stop'
$lock=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'model-lock.json') | ConvertFrom-Json
$gpuTool=Get-Command nvidia-smi -ErrorAction SilentlyContinue
if(-not $gpuTool){throw 'BLOCKED: run on the actual NVIDIA Windows PC; install its official driver first.'}
$gpuInfo=& $gpuTool.Source --query-gpu=name,memory.total,memory.free,driver_version --format=csv,noheader
if($LASTEXITCODE -ne 0){throw 'NVIDIA query failed'}
Write-Output $gpuInfo
New-Item -ItemType Directory -Force -Path $ModelRoot | Out-Null
$resolvedRoot=(Resolve-Path -LiteralPath $ModelRoot).Path
$drive=Get-PSDrive -Name ([IO.Path]::GetPathRoot($resolvedRoot).Substring(0,1))
if($drive.Free -lt 9GB){throw 'BLOCKED: need at least 9GiB free for weights and checked archives'}
$bin=Join-Path $resolvedRoot $lock.llama.tag
New-Item -ItemType Directory -Force -Path $bin | Out-Null
function Receive-Checked([string]$Url,[string]$Destination,[string]$Sha256){
  if(-not(Test-Path -LiteralPath $Destination)){Invoke-WebRequest -Uri $Url -OutFile $Destination}
  if((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256){throw 'BLOCKED checksum mismatch; existing file retained for investigation, not executed'}
}
foreach($archive in $lock.llama.archives){
  $zip=Join-Path $resolvedRoot $archive.file
  Receive-Checked $archive.url $zip $archive.sha256
  Expand-Archive -LiteralPath $zip -DestinationPath $bin -Force
}
$weights=Join-Path $resolvedRoot $lock.model.file
Receive-Checked $lock.model.url $weights $lock.model.sha256
if((Get-Item -LiteralPath $weights).Length -ne $lock.model.sizeBytes){throw 'BLOCKED model size mismatch'}
$servers=@(Get-ChildItem -LiteralPath $bin -Filter llama-server.exe -Recurse)
if($servers.Count -ne 1){throw 'BLOCKED: expected one checked llama-server.exe'}
$help=(& $servers[0].FullName --help 2>&1 | Out-String)
if($LASTEXITCODE -ne 0){throw 'BLOCKED: binary/driver is not executable on this host'}
foreach($flag in @('--reasoning','--chat-template-kwargs','--api-key-file','--no-webui','--log-disable')){if(-not $help.Contains($flag)){throw "BLOCKED missing supported option $flag"}}
$devices=(& $servers[0].FullName --list-devices 2>&1 | Out-String)
if($LASTEXITCODE -ne 0 -or $devices -notmatch 'CUDA'){throw 'BLOCKED: checked binary did not report a CUDA device; CPU fallback is not accepted as GPU verification'}
$evidence=@{tag=$lock.llama.tag;modelSha256=$lock.model.sha256;binarySha256=(Get-FileHash -LiteralPath $servers[0].FullName).Hash.ToLowerInvariant();helpChecked=$true;inferenceChecked=$false;gpu=$gpuInfo}
$evidence | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $resolvedRoot 'model-install-evidence.json') -Encoding utf8
Write-Output 'OK checked files and executable help. Inference, thinking mode, VRAM headroom and quality still require measurement.'
