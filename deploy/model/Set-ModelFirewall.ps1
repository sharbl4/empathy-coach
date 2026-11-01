#requires -Version 7.0
#requires -RunAsAdministrator
param([Parameter(Mandatory)][string]$ModelRoot,[Parameter(Mandatory)][string]$HomeTailscaleIp,[Parameter(Mandatory)][string]$CloudTailscaleIp)
$ErrorActionPreference='Stop'
foreach($ip in @($HomeTailscaleIp,$CloudTailscaleIp)){
  $parsed=[Net.IPAddress]::Parse($ip);$bytes=$parsed.GetAddressBytes()
  if($bytes.Length -ne 4 -or $bytes[0] -ne 100 -or $bytes[1] -lt 64 -or $bytes[1] -gt 127){throw 'Only numeric Tailscale IPv4 addresses allowed'}
}
if($HomeTailscaleIp -eq $CloudTailscaleIp){throw 'Cloud and home must be different devices'}
if(@(Get-NetFirewallProfile -PolicyStore ActiveStore | Where-Object {$_.Enabled -ne 'True' -or $_.DefaultInboundAction -ne 'Block'}).Count){throw 'BLOCKED: firewall must be enabled with effective default inbound Block; no global setting is changed by this script'}
$lock=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'model-lock.json') | ConvertFrom-Json
$server=@(Get-ChildItem -LiteralPath (Join-Path $ModelRoot $lock.llama.tag) -Filter llama-server.exe -Recurse)
if($server.Count -ne 1){throw 'Run checked installer first'}
$exe=$server[0].FullName
$adapter=Get-NetIPAddress -AddressFamily IPv4 -IPAddress $HomeTailscaleIp
if(-not $adapter){throw 'Home address is not assigned on this PC'}
function Includes-Port($ports){foreach($port in $ports){if($port -eq 'Any' -or $port -eq '8080'){return $true};if($port -match '^(\d+)-(\d+)$' -and [int]$Matches[1] -le 8080 -and [int]$Matches[2] -ge 8080){return $true}};return $false}
foreach($rule in Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Direction Inbound -Action Allow){
  if($rule.Name -eq 'BetweenLines-PrivateLLM'){continue}
  $port=$rule | Get-NetFirewallPortFilter;$app=$rule | Get-NetFirewallApplicationFilter
  if($port.Protocol -in @('TCP','6','Any') -and (Includes-Port $port.LocalPort) -and $app.Program -in @('Any',$exe)){throw 'BLOCKED: an existing broad/overlapping inbound allow rule needs owner review; no rule was removed'}
}
if(Get-NetFirewallRule -Name 'BetweenLines-PrivateLLM' -ErrorAction SilentlyContinue){throw 'Existing project rule: review/remove that exact rule manually before changing devices'}
New-NetFirewallRule -Name 'BetweenLines-PrivateLLM' -DisplayName 'BetweenLines private local LLM' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080 -LocalAddress $HomeTailscaleIp -RemoteAddress $CloudTailscaleIp -InterfaceAlias $adapter.InterfaceAlias -Program $exe -Profile Any | Out-Null
Write-Output 'Created one restricted inbound rule; verify allowed cloud and denied peer before release. Router/default policy unchanged.'
