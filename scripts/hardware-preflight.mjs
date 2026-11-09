import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'

const execute = promisify(execFile)
const endpoint = process.env.CRYCHART_CDP ?? 'http://127.0.0.1:9223'
const browser = await chromium.connectOverCDP(endpoint)
let report
try {
  const session = await browser.newBrowserCDPSession()
  const [processes, system] = await Promise.all([session.send('SystemInfo.getProcessInfo'), session.send('SystemInfo.getInfo')])
  const chromeIds = processes.processInfo.map(process => process.id).filter(Number.isInteger)
  const {stdout} = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('scripts/hardware-preflight.ps1'), '-ChromePidCsv', chromeIds.join(',')], {windowsHide: true, maxBuffer: 1024 * 1024})
  const pages = browser.contexts().flatMap(context => context.pages())
  // Read-only: this helper never changes tabs, navigation, browser focus or data.
  const own = pages.find(page => /^http:\/\/127\.0\.0\.1:4178\//.test(page.url()))
  const pageMetrics = own ? await own.evaluate(() => ({url: location.href, heap: performance.memory ? {limitBytes: performance.memory.jsHeapSizeLimit, totalBytes: performance.memory.totalJSHeapSize, usedBytes: performance.memory.usedJSHeapSize} : null, deviceMemoryReportedGiB: navigator.deviceMemory, hardwareConcurrency: navigator.hardwareConcurrency})) : null
  report = {...JSON.parse(stdout), browser: browser.version(), dedicatedChromeProcesses: processes.processInfo, gpuDevices: system.gpu.devices, pages: pages.map(page => page.url()), pageMetrics, heapLimitQualification: 'The JavaScript heap limit is not a measurement of remaining GPU memory or total chart-data capacity.'}
  await session.detach()
} finally {await browser.close()}
const directory = 'codex_artifact/hardware-preflight'
await mkdir(directory, {recursive: true})
const file = `${directory}/${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.json`
await writeFile(file, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({file, availablePhysicalGiB: report.memory.AvailableBytes / 2**30, commitAvailableGiB: (report.memory.CommitLimit - report.memory.CommittedBytes) / 2**30, dedicatedChromeProcessCount: report.chromeProcesses.length, pages: report.pages}))
