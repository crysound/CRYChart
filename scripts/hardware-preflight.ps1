param([string]$ChromePidCsv = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$taskCpu = Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed
$taskOs = Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,TotalVisibleMemorySize,FreePhysicalMemory,TotalVirtualMemorySize,FreeVirtualMemory
$taskMemory = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory | Select-Object AvailableBytes,CommittedBytes,CommitLimit,PoolNonpagedBytes,CacheBytes
$taskGpu = @(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,VideoProcessor)
$taskChrome = @()
if ($ChromePidCsv) {
  if ($ChromePidCsv -notmatch '^\d+(,\d+)*$') { throw 'Chrome PID list must contain decimal process identifiers only' }
  foreach ($taskPidText in $ChromePidCsv.Split(',')) {
    try {
      $taskProcess = Get-Process -Id ([int]$taskPidText) -ErrorAction Stop
      if ($taskProcess.ProcessName -ne 'chrome') { continue }
      $taskChrome += [pscustomobject]@{ id=$taskProcess.Id; workingSetBytes=$taskProcess.WorkingSet64; privateBytes=$taskProcess.PrivateMemorySize64; virtualBytes=$taskProcess.VirtualMemorySize64; cpuSeconds=$taskProcess.CPU }
    } catch { }
  }
}
[pscustomobject]@{
  recordedAt=[DateTime]::UtcNow.ToString('o')
  cpu=$taskCpu
  operatingSystem=$taskOs
  memory=$taskMemory
  videoControllers=$taskGpu
  chromeProcesses=$taskChrome
  limitations=@('Win32 AdapterRAM is neither the remaining GPU budget nor a reliable shared-memory limit.','Chrome working sets can include shared pages; their sum is not unique physical allocation.','Only Chrome process identifiers supplied by the dedicated browser CDP are sampled. Other applications are not terminated or modified.')
} | ConvertTo-Json -Depth 6 -Compress
