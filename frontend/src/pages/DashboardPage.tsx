import { type ComponentType, type ReactNode, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchSystemHistory, fetchSystemInfo } from '@/lib/dockerApi'
import {
  Activity,
  Box,
  Container,
  Cpu,
  HardDrive,
  Layers3,
  MemoryStick,
  Network,
  Package,
} from 'lucide-react'
import type { DockerSystemInfo, ResourceHistory } from '@/types/api'

type HistoryWindow = '5m' | '15m' | '1h' | '1d' | '1month'
type DashboardTab = 'overview' | 'performance' | 'storage'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`
}

function formatGigabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}`
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`
}

function HeroStatCard({
  label,
  value,
  detail,
  surfaceClass,
}: {
  label: string
  value: ReactNode
  detail?: string
  surfaceClass: string
}) {
  return (
    <div
      className={`flex min-h-[132px] flex-col justify-between rounded-2xl border p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur sm:min-h-[142px] sm:p-4 ${surfaceClass}`}
    >
      <p className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-300">{label}</p>
      <div>
        <div className="text-[1.55rem] font-semibold tracking-tight text-slate-900 dark:text-slate-50 sm:text-[1.7rem] xl:text-[1.8rem]">
          {value}
        </div>
        {detail ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{detail}</p>
        ) : null}
      </div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string
  value: string | number
  hint: string
  icon: ComponentType<{ className?: string }>
  accent: string
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
          <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
        </div>
        <div className={`rounded-2xl ${accent} p-3 text-white shadow-sm`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  )
}

function SectionButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm transition-colors ${
        active
          ? 'bg-foreground text-background'
          : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

function LineChart({
  points,
  colorClass,
  startLabel,
  endLabel,
  topLabel,
  middleLabel,
  bottomLabel,
}: {
  points: { x: number; y: number }[]
  colorClass: string
  startLabel: string
  endLabel: string
  topLabel: string
  middleLabel: string
  bottomLabel: string
}) {
  return (
    <div className="mt-4 grid min-h-[228px] grid-cols-[52px_minmax(0,1fr)] gap-3">
      <div className="flex flex-col justify-between pb-6 text-[10px] text-muted-foreground sm:text-xs">
        <span>{topLabel}</span>
        <span>{middleLabel}</span>
        <span>{bottomLabel}</span>
      </div>
      {points.length > 0 ? (
        <div className="min-w-0">
          <svg
            viewBox="0 0 100 64"
            preserveAspectRatio="none"
            className={`h-44 w-full ${colorClass}`}
          >
            <line
              x1={0}
              y1={0}
              x2={100}
              y2={0}
              stroke="currentColor"
              strokeWidth={0.25}
              className="text-muted-foreground"
            />
            <line
              x1={0}
              y1={32}
              x2={100}
              y2={32}
              stroke="currentColor"
              strokeWidth={0.25}
              className="text-muted-foreground"
            />
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={64}
              stroke="currentColor"
              strokeWidth={0.25}
              className="text-muted-foreground"
            />
            <line
              x1={0}
              y1={64}
              x2={100}
              y2={64}
              stroke="currentColor"
              strokeWidth={0.25}
              className="text-muted-foreground"
            />
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={points.map((point) => `${point.x},${point.y}`).join(' ')}
            />
          </svg>
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground sm:text-xs">
            <span>{startLabel}</span>
            <span>{endLabel}</span>
          </div>
        </div>
      ) : (
        <div className="col-span-2 flex h-[176px] items-center text-xs text-muted-foreground">
          Waiting for samples...
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const [historyWindow, setHistoryWindow] = useState<HistoryWindow>('5m')
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')

  const { data: systemInfo, isLoading } = useQuery<DockerSystemInfo>({
    queryKey: ['system'],
    queryFn: () => fetchSystemInfo(true),
    refetchInterval: 2000,
  })

  const { data: history } = useQuery<ResourceHistory>({
    queryKey: ['system-history', historyWindow],
    queryFn: () => fetchSystemHistory(historyWindow),
    refetchInterval: 2000,
  })

  const timestampsMs = (history?.points ?? []).map((point) =>
    new Date(point.timestamp).getTime()
  )
  const hasHistory = timestampsMs.length > 0
  const minTimeMs = hasHistory ? Math.min(...timestampsMs) : 0
  const maxTimeMs = hasHistory ? Math.max(...timestampsMs) : 0
  const timeRangeMs = maxTimeMs - minTimeMs || 1
  const startTime = hasHistory ? new Date(minTimeMs) : null
  const endTime = hasHistory ? new Date(maxTimeMs) : null

  const hostMemoryMb = systemInfo?.host_memory_mb ?? 0
  const currentMemoryPercent = hostMemoryMb > 0
    ? ((systemInfo?.total_memory_mb ?? 0) / hostMemoryMb) * 100
    : 0

  const cpuPoints = useMemo(() => {
    if (!history?.points?.length) return []
    const height = 64
    const topPad = 4
    const bottomPad = 4
    const innerHeight = height - topPad - bottomPad
    return history.points.map((point) => {
      const timestamp = new Date(point.timestamp).getTime()
      const x = ((timestamp - minTimeMs) / timeRangeMs) * 100
      const value = Math.min(100, Math.max(0, point.cpu_percent ?? 0))
      const y = topPad + (1 - value / 100) * innerHeight
      return { x, y }
    })
  }, [history, minTimeMs, timeRangeMs])

  const memoryPoints = useMemo(() => {
    if (!history?.points?.length) return []
    const height = 64
    const topPad = 4
    const bottomPad = 4
    const innerHeight = height - topPad - bottomPad
    return history.points.map((point) => {
      const timestamp = new Date(point.timestamp).getTime()
      const x = ((timestamp - minTimeMs) / timeRangeMs) * 100
      const value = hostMemoryMb > 0
        ? Math.min(100, Math.max(0, ((point.memory_mb ?? 0) / hostMemoryMb) * 100))
        : 0
      const y = topPad + (1 - value / 100) * innerHeight
      return { x, y }
    })
  }, [history, hostMemoryMb, minTimeMs, timeRangeMs])

  const formatTimeLabel = (date: Date, window: HistoryWindow) => {
    if (window === '5m' || window === '15m' || window === '1h') {
      return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })
    }

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (isLoading || !systemInfo) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-lg text-muted-foreground">Loading dashboard...</div>
      </div>
    )
  }

  const totalMemoryGb = formatGigabytes(systemInfo.total_memory_bytes)

  return (
    <div className="space-y-5 p-4 sm:space-y-6 sm:p-6 2xl:p-8">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-blue-100 px-5 py-5 text-slate-950 shadow-lg dark:border-slate-800 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950 dark:text-slate-50 sm:px-6 sm:py-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(220px,0.72fr)_minmax(0,1.28fr)] xl:items-stretch">
          <div className="flex min-h-[142px] flex-col justify-between xl:min-h-[142px]">
            <div className="inline-flex items-center gap-2 self-start rounded-full bg-slate-900/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-600 dark:bg-white/10 dark:text-slate-200">
              <Layers3 className="h-3.5 w-3.5" />
              sysDock Dashboard
            </div>
            <p className="max-w-xs text-xs text-slate-500 dark:text-slate-400 md:text-sm">
              * resource info refreshes every 2 seconds
            </p>
          </div>
          <div className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <HeroStatCard
              label="Running"
              value={systemInfo.containers_running}
              detail="Active workloads"
              surfaceClass="border-emerald-300/50 bg-white/70 dark:border-emerald-400/20 dark:bg-emerald-400/10"
            />
            <HeroStatCard
              label="CPU"
              value={`${systemInfo.total_cpu_percent}%`}
              detail="Live aggregate load"
              surfaceClass="border-sky-300/50 bg-white/70 dark:border-sky-400/20 dark:bg-sky-400/10"
            />
            <HeroStatCard
              label="Memory"
              value={
                <div className="leading-[1.05]">
                  <span className="block whitespace-nowrap">{totalMemoryGb}</span>
                  <span className="mt-1.5 block text-[1.05rem] sm:text-[1.15rem]">GB</span>
                </div>
              }
              detail="Working set now"
              surfaceClass="border-fuchsia-300/50 bg-white/70 dark:border-fuchsia-400/20 dark:bg-fuchsia-400/10"
            />
            <HeroStatCard
              label="Engine"
              value={<span className="whitespace-nowrap">{systemInfo.docker_version}</span>}
              detail="Connected daemon"
              surfaceClass="border-amber-300/50 bg-white/70 dark:border-amber-300/20 dark:bg-amber-300/10"
            />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <MetricCard
          label="Containers"
          value={systemInfo.containers_total}
          hint={`${systemInfo.containers_running} running now`}
          icon={Container}
          accent="bg-emerald-500"
        />
        <MetricCard
          label="Images"
          value={systemInfo.images_count}
          hint="Available to launch"
          icon={Package}
          accent="bg-sky-500"
        />
        <MetricCard
          label="Networks"
          value={systemInfo.networks_count}
          hint="Network surfaces configured"
          icon={Network}
          accent="bg-amber-500"
        />
        <MetricCard
          label="Volumes"
          value={systemInfo.volumes_count}
          hint="Persistent data endpoints"
          icon={HardDrive}
          accent="bg-fuchsia-500"
        />
      </section>

      <section className="rounded-[24px] border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Workspace Panels</h2>
            <p className="text-sm text-muted-foreground">
              Switch between operational overview, live performance, and storage analysis.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 rounded-full bg-muted p-1">
            <SectionButton
              active={activeTab === 'overview'}
              label="Overview"
              onClick={() => setActiveTab('overview')}
            />
            <SectionButton
              active={activeTab === 'performance'}
              label="Performance"
              onClick={() => setActiveTab('performance')}
            />
            <SectionButton
              active={activeTab === 'storage'}
              label="Storage"
              onClick={() => setActiveTab('storage')}
            />
          </div>
        </div>
      </section>

      {activeTab === 'overview' && (
        <section className="grid grid-cols-1 gap-4 2xl:grid-cols-[1.4fr_1fr]">
          <div className="rounded-[24px] border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Container State</h3>
                <p className="text-sm text-muted-foreground">
                  Current lifecycle mix across the local engine.
                </p>
              </div>
              <Box className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              <MetricCard
                label="Running"
                value={systemInfo.containers_running}
                hint="Healthy active workloads"
                icon={Container}
                accent="bg-emerald-500"
              />
              <MetricCard
                label="Stopped"
                value={systemInfo.containers_stopped}
                hint="Stopped intentionally"
                icon={Container}
                accent="bg-orange-500"
              />
              <MetricCard
                label="Exited"
                value={systemInfo.containers_exited}
                hint="Need inspection or restart"
                icon={Container}
                accent="bg-rose-500"
              />
              <MetricCard
                label="Created"
                value={systemInfo.containers_created}
                hint="Defined but not started"
                icon={Container}
                accent="bg-blue-500"
              />
            </div>
          </div>

          <div className="rounded-[24px] border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Engine Snapshot</h3>
                <p className="text-sm text-muted-foreground">
                  Quick metadata about the connected daemon.
                </p>
              </div>
              <Activity className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="mt-5 space-y-4 text-sm">
              <div className="flex items-center justify-between rounded-2xl bg-muted/60 px-4 py-3">
                <span className="text-muted-foreground">Docker version</span>
                <span className="font-medium">{systemInfo.docker_version}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-muted/60 px-4 py-3">
                <span className="text-muted-foreground">Server version</span>
                <span className="font-medium">{systemInfo.server_version}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-muted/60 px-4 py-3">
                <span className="text-muted-foreground">Memory footprint</span>
                <span className="font-medium">{formatBytes(systemInfo.total_memory_bytes)}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-muted/60 px-4 py-3">
                <span className="text-muted-foreground">Tracked resources</span>
                <span className="font-medium">
                  {systemInfo.images_count + systemInfo.networks_count + systemInfo.volumes_count}
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'performance' && (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 rounded-[24px] border bg-card p-5 shadow-sm md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Live Performance</h3>
              <p className="text-sm text-muted-foreground">
                Engine usage trends taken from the recent metrics history.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Window</span>
              <select
                className="rounded-full border bg-background px-3 py-2 text-xs"
                value={historyWindow}
                onChange={(event) => setHistoryWindow(event.target.value as HistoryWindow)}
              >
                <option value="5m">Last 5 min</option>
                <option value="15m">Last 15 min</option>
                <option value="1h">Last 1 hour</option>
                <option value="1d">Last 1 day</option>
                <option value="1month">Last 1 month</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3">
            <div className="flex h-full flex-col rounded-[24px] border bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-semibold">CPU Activity</h4>
                  <p className="text-sm text-muted-foreground">
                    Aggregate usage across running containers.
                  </p>
                </div>
                <Cpu className="h-5 w-5 text-blue-600" />
              </div>
              <div className="mt-4 min-h-[52px]">
                <p className="text-3xl font-semibold">{systemInfo.total_cpu_percent}%</p>
              </div>
              <LineChart
                points={cpuPoints}
                colorClass="text-blue-500"
                topLabel="100%"
                middleLabel="50%"
                bottomLabel="0%"
                startLabel={startTime ? formatTimeLabel(startTime, historyWindow) : '--'}
                endLabel={endTime ? formatTimeLabel(endTime, historyWindow) : '--'}
              />
            </div>

            <div className="flex h-full flex-col rounded-[24px] border bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-semibold">Memory Footprint</h4>
                  <p className="text-sm text-muted-foreground">
                    Working set currently attributed to active containers.
                  </p>
                </div>
                <MemoryStick className="h-5 w-5 text-fuchsia-600" />
              </div>
              <div className="mt-4 flex min-h-[52px] flex-col justify-end">
                <p className="text-3xl font-semibold">{systemInfo.total_memory_mb} MB</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatPercent(currentMemoryPercent)} of {formatBytes(systemInfo.host_memory_bytes)} host memory
                </p>
              </div>
              <LineChart
                points={memoryPoints}
                colorClass="text-fuchsia-500"
                topLabel="100%"
                middleLabel="50%"
                bottomLabel="0%"
                startLabel={startTime ? formatTimeLabel(startTime, historyWindow) : '--'}
                endLabel={endTime ? formatTimeLabel(endTime, historyWindow) : '--'}
              />
            </div>

            <div className="rounded-[24px] border bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-base font-semibold">Version Health</h4>
                  <p className="text-sm text-muted-foreground">
                    Runtime metadata for the connected engine and API server.
                  </p>
                </div>
                <Activity className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="mt-5 space-y-3">
                <div className="rounded-2xl bg-muted/60 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Docker</p>
                  <p className="mt-1 text-xl font-semibold">{systemInfo.docker_version}</p>
                </div>
                <div className="rounded-2xl bg-muted/60 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Server</p>
                  <p className="mt-1 text-xl font-semibold">{systemInfo.server_version}</p>
                </div>
                <div className="rounded-2xl bg-muted/60 px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Samples</p>
                  <p className="mt-1 text-xl font-semibold">{history?.points.length ?? 0}</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'storage' && (
        <section>
          <div className="rounded-[24px] border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Artifact Storage</h3>
                <p className="text-sm text-muted-foreground">
                  Inventory and reclaimable space from `docker system df`.
                </p>
              </div>
              <Package className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="mt-5 space-y-3">
              {[
                {
                  label: 'Images',
                  count: systemInfo.system_df.images?.count ?? 0,
                  total: systemInfo.system_df.images?.total_size ?? 0,
                  reclaimable: systemInfo.system_df.images?.reclaimable ?? 0,
                },
                {
                  label: 'Containers',
                  count: systemInfo.system_df.containers?.count ?? 0,
                  total: systemInfo.system_df.containers?.total_size ?? 0,
                  reclaimable: systemInfo.system_df.containers?.reclaimable ?? 0,
                },
                {
                  label: 'Volumes',
                  count: systemInfo.system_df.volumes?.count ?? 0,
                  total: systemInfo.system_df.volumes?.total_size ?? 0,
                  reclaimable: systemInfo.system_df.volumes?.reclaimable ?? 0,
                },
                {
                  label: 'Build cache',
                  count: systemInfo.system_df.build_cache?.count ?? 0,
                  total: systemInfo.system_df.build_cache?.total_size ?? 0,
                  reclaimable: systemInfo.system_df.build_cache?.reclaimable ?? 0,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-2xl bg-muted/60 px-4 py-4"
                >
                  <div>
                    <p className="font-medium">{item.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.count} items, {formatBytes(item.total)} total
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Reclaimable
                    </p>
                    <p className="mt-1 font-semibold text-orange-600">
                      {formatBytes(item.reclaimable)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
