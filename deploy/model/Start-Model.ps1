#requires -Version 7.0
param([Parameter(Mandatory)][string]$ModelRoot,[string]$BindAddress='127.0.0.1',[string]$CloudTailscaleIp,[ValidateRange(0,99)][int]$GpuLayers=24,[ValidateRange(512,4096)][int]$Context=4096)
$ErrorActionPreference='Stop'
$lock=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'model-lock.json') | ConvertFrom-Json
if($BindAddress -ne '127.0.0.1' -and $BindAddress -notmatch '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}$'){throw 'Only loopback or the actual Tailscale IPv4 is allowed; never 0.0.0.0'}
if(-not(Get-NetIPAddress -IPAddress $BindAddress -ErrorAction SilentlyContinue)){throw 'Bind address is not assigned to this PC'}
$weights=Join-Path $ModelRoot $lock.model.file
if((Get-FileHash -LiteralPath $weights).Hash.ToLowerInvariant() -ne $lock.model.sha256){throw 'Model hash mismatch'}
$server=@(Get-ChildItem -LiteralPath (Join-Path $ModelRoot $lock.llama.tag) -Recurse -Filter llama-server.exe)
if($server.Count -ne 1){throw 'Run Install-Model first'}
$exe=$server[0].FullName
if(@(Get-Process | Where-Object {$_.Path -eq $exe}).Count){throw 'Model server already running from this dedicated directory'}
$evidence=Get-Content -Raw -LiteralPath (Join-Path $ModelRoot 'model-install-evidence.json') | ConvertFrom-Json
if((Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant() -ne $evidence.binarySha256){throw 'Binary changed after installation check'}
if($BindAddress -ne '127.0.0.1'){
  $rule=Get-NetFirewallRule -Name 'BetweenLines-PrivateLLM' -ErrorAction SilentlyContinue
  if(-not $rule -or $rule.Enabled -ne 'True'){throw 'Run Set-ModelFirewall as administrator before private-network binding'}
  $filter=$rule | Get-NetFirewallAddressFilter
  if($filter.LocalAddress -notcontains $BindAddress){throw 'Firewall local address mismatch'}
  if(-not $CloudTailscaleIp -or @($filter.RemoteAddress).Count -ne 1 -or $filter.RemoteAddress -notcontains $CloudTailscaleIp){throw 'Firewall must restrict exactly the configured cloud Tailscale IP'}
  $portFilter=$rule | Get-NetFirewallPortFilter
  $appFilter=$rule | Get-NetFirewallApplicationFilter
  if($portFilter.Protocol -notin @('TCP','6') -or @($portFilter.LocalPort).Count -ne 1 -or $portFilter.LocalPort -notcontains '8080' -or $appFilter.Program -ne $exe){throw 'Firewall program/port mismatch'}
  if(@(Get-NetFirewallProfile -PolicyStore ActiveStore | Where-Object {$_.Enabled -ne 'True' -or $_.DefaultInboundAction -ne 'Block'}).Count){throw 'Effective firewall must remain enabled/default inbound Block'}
}
$key=Join-Path $ModelRoot 'endpoint.key'
if(-not(Test-Path -LiteralPath $key)){
  $bytes=[byte[]]::new(32);[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  [Convert]::ToHexString($bytes).ToLowerInvariant() | Set-Content -LiteralPath $key -NoNewline
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls.exe $key /inheritance:r /grant:r "*${sid}:(F)" '*S-1-5-18:(F)' | Out-Null
  if($LASTEXITCODE -ne 0){throw 'Key ACL setup failed'}
}
# Key is passed by file, never in argv/output. Copy it only into private cloud secret settings.
$arguments=@('-m',$weights,'--alias',$lock.candidateSettings.alias,'--host',$BindAddress,'--port','8080','--ctx-size',"$Context",'--parallel','1','--n-gpu-layers',"$GpuLayers",'--batch-size','128','--ubatch-size','128','--n-predict','1024','--jinja','--reasoning','off','--chat-template-kwargs','{"enable_thinking":false}','--api-key-file',$key,'--no-webui','--no-agent','--log-disable')
Write-Output 'Starting foreground model server; output is discarded. Run Stop-Model in another terminal. Measure GPU/latency before accepting settings.'
& $exe @arguments *> $null
if($LASTEXITCODE -ne 0){throw 'Model server exited unsuccessfully. Check driver/VRAM; lower context or GPU layers explicitly, do not change model silently.'}
