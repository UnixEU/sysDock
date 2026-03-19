import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, DatabaseZap, Hammer, Loader2, ScanSearch, TerminalSquare } from 'lucide-react'
import { toast } from 'sonner'
import { runMaintenancePrune } from '@/lib/dockerApi'
import type { MaintenanceAction, MaintenanceActionResult } from '@/types/api'

type MaintenanceCard = {
  action: MaintenanceAction
  title: string
  description: string
  command: string
  forceCommand: string
  tone: string
  icon: typeof ScanSearch
}

const maintenanceCards: MaintenanceCard[] = [
  {
    action: 'images',
    title: 'Image Prune',
    description: 'Remove unused images and reclaim storage tied to stale image layers.',
    command: 'docker image prune',
    forceCommand: 'docker image prune -a -f',
    tone: 'border-sky-500/20 from-sky-500/15 to-cyan-500/10',
    icon: ScanSearch,
  },
  {
    action: 'volumes',
    title: 'Volume Prune',
    description: 'Delete unused volumes that are no longer attached to active workloads.',
    command: 'docker volume prune',
    forceCommand: 'docker volume prune -f',
    tone: 'border-fuchsia-500/20 from-fuchsia-500/15 to-pink-500/10',
    icon: DatabaseZap,
  },
  {
    action: 'builder',
    title: 'Builder Prune',
    description: 'Clear unused build cache artifacts left behind by image build activity.',
    command: 'docker builder prune',
    forceCommand: 'docker builder prune -a -f',
    tone: 'border-amber-500/20 from-amber-500/15 to-orange-500/10',
    icon: Hammer,
  },
  {
    action: 'system',
    title: 'System Prune',
    description: 'Run a broader cleanup across idle containers, networks, images, and cache.',
    command: 'docker system prune',
    forceCommand: 'docker system prune -a --volumes -f',
    tone: 'border-rose-500/20 from-rose-500/15 to-orange-500/10',
    icon: AlertTriangle,
  },
]

function normalizeError(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'data' in error.response
  ) {
    const responseData = (error.response as { data?: { detail?: unknown } }).data
    if (typeof responseData?.detail === 'string') {
      return responseData.detail
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Maintenance action failed.'
}

export default function MaintenancePage() {
  const queryClient = useQueryClient()
  const [forceByAction, setForceByAction] = useState<Record<MaintenanceAction, boolean>>({
    images: false,
    volumes: false,
    builder: false,
    system: false,
  })
  const [lastResult, setLastResult] = useState<MaintenanceActionResult | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [lastCommand, setLastCommand] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: ({ action, force }: { action: MaintenanceAction; force: boolean }) =>
      runMaintenancePrune(action, { force }),
    onMutate: ({ action, force }) => {
      const card = maintenanceCards.find((item) => item.action === action)
      setLastCommand(card ? (force ? card.forceCommand : card.command) : null)
    },
    onSuccess: (result) => {
      setLastResult(result)
      setLastError(null)
      toast.success(result.message)
      void queryClient.invalidateQueries({ queryKey: ['system'] })
    },
    onError: (error) => {
      const message = normalizeError(error)
      setLastError(message)
      setLastResult(null)
      toast.error(message)
    },
  })

  const activeCommand = useMemo(() => {
    if (!mutation.variables) return null
    const card = maintenanceCards.find((item) => item.action === mutation.variables.action)
    if (!card) return null
    return mutation.variables.force ? card.forceCommand : card.command
  }, [mutation.variables])

  return (
    <div className="space-y-6 p-4 sm:p-6 2xl:p-8">
      <section className="rounded-[28px] border bg-gradient-to-br from-slate-50 via-white to-slate-100 p-6 shadow-sm dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-600 dark:bg-white/10 dark:text-slate-200">
              <TerminalSquare className="h-3.5 w-3.5" />
              Maintenance
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50 sm:text-4xl">
                Administrative Docker cleanup actions
              </h1>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300 sm:text-base">
                Run focused prune operations from the web UI and inspect the exact execution output
                returned by the backend.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            Use these actions carefully. Prune operations permanently remove unused Docker artifacts.
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-4">
        {maintenanceCards.map((card) => {
          const isRunning = mutation.isPending && mutation.variables?.action === card.action
          const Icon = card.icon
          const force = forceByAction[card.action]
          const command = force ? card.forceCommand : card.command

          return (
            <div
              key={card.action}
              className={`rounded-[24px] border bg-gradient-to-br p-6 shadow-sm dark:bg-card dark:bg-none ${card.tone}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">{card.title}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{card.description}</p>
                </div>
                <div className="rounded-2xl bg-background/80 p-3 shadow-sm dark:bg-white/10">
                  <Icon className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-5 rounded-2xl border bg-background/80 p-4 dark:bg-slate-950/40">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Command preview</p>
                <p className="mt-2 font-mono text-sm">{command}</p>
              </div>

              <label className="mt-4 flex items-center gap-3 rounded-2xl border bg-background/80 px-4 py-3 text-sm dark:bg-slate-950/40">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(event) =>
                    setForceByAction((current) => ({
                      ...current,
                      [card.action]: event.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-input"
                />
                <span>Force mode</span>
              </label>

              <button
                type="button"
                onClick={() => mutation.mutate({ action: card.action, force })}
                disabled={mutation.isPending}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                {isRunning ? 'Running action...' : `Run ${card.title}`}
              </button>
            </div>
          )
        })}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-[24px] border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Execution Notes</h2>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <p>Image prune runs in safe mode by default and switches to all unused images when force mode is enabled.</p>
            <p>Volume prune targets only unused volumes, but the force toggle still reflects the CLI-style command you asked for.</p>
            <p>System prune becomes broader in force mode and includes unused volumes in the aggregated cleanup pass.</p>
          </div>
        </div>

        <div className="rounded-[24px] border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Execution Output</h2>
              <p className="text-sm text-muted-foreground">
                The latest command output is shown below for both successful and failed runs.
              </p>
            </div>
            {mutation.isPending && activeCommand ? (
              <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                Running
              </span>
            ) : null}
          </div>

          <div className="mt-5 rounded-2xl border bg-slate-950 p-4 text-slate-100 shadow-inner">
            <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
              <TerminalSquare className="h-4 w-4" />
              Console
            </div>
            <pre className="min-h-[240px] overflow-x-auto whitespace-pre-wrap font-mono text-sm leading-6">
              {mutation.isPending && activeCommand
                ? `$ ${activeCommand}\nRunning...`
                : lastError
                  ? `${lastCommand ? `$ ${lastCommand}\n` : ''}Command failed.\n${lastError}`
                  : lastResult?.output ?? 'No maintenance action has been executed yet.'}
            </pre>
          </div>
        </div>
      </section>
    </div>
  )
}
