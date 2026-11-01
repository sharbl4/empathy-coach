#requires -Version 7.0
param([ValidateRange(2,300)][int]$Samples=60,[string]$OutputFile='.tools/model-hardware-report.json')
$ErrorActionPreference='Stop'
$gpuTool=Get-Command nvidia-smi -ErrorAction SilentlyContinue
if(-not $gpuTool){throw 'Run on actual NVIDIA GPU PC; no CPU evidence substituted.'}
$rows=@()
for($index=0;$index -lt $Samples;$index++){
  $raw=@(& $gpuTool.Source --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu,driver_version --format=csv,noheader,nounits)
  if($LASTEXITCODE -ne 0 -or $raw.Count -ne 1){throw 'Expected one GPU and successful NVIDIA query'}
  $parts=$raw[0].Split(',').Trim()
  if($parts.Count -ne 6){throw 'Unexpected NVIDIA result'}
  $rows+=@{totalMiB=[int]$parts[1];usedMiB=[int]$parts[2];freeMiB=[int]$parts[3];utilization=[int]$parts[4]}
  if($index -lt $Samples-1){Start-Sleep -Seconds 1}
}
$parent=Split-Path -Parent $OutputFile
if($parent){New-Item -ItemType Directory -Force -Path $parent | Out-Null}
$report=@{gpu=$parts[0];driver=$parts[5];samples=$Samples;totalMiB=$rows[0].totalMiB;peakUsedMiB=($rows.usedMiB | Measure-Object -Maximum).Maximum;minimumFreeMiB=($rows.freeMiB | Measure-Object -Minimum).Minimum;fullGpuPlacementVerified=$false;workloadVerified=$false}
$report | ConvertTo-Json | Set-Content -LiteralPath $OutputFile -Encoding utf8
Write-Output 'Hardware-only report saved; run during the benchmark. No model content captured; placement/quality are not inferred from utilization.'
