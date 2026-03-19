import { useEffect, useRef, useState, Dispatch, SetStateAction } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'
import api from '@/lib/api'
import {
  createFromCompose,
  fetchComposeContent,
  fetchContainerDetails,
  fetchContainers,
  updateComposeContent,
  updateContainer,
} from '@/lib/dockerApi'
import { useAuthStore } from '@/stores/authStore'
import { toast } from 'sonner'
import { Play, Square, RotateCw, Eye, Edit, Trash2, FileCode, X, Plus, Minus, FileText } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import type { ContainerDetail, ContainerInfo, ContainerUpdatePayload } from '@/types/api'

type SelectedContainer = ContainerInfo &
  Partial<Omit<ContainerDetail, keyof ContainerInfo>>

function extractErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.detail ?? error.message ?? fallback
  }
  return fallback
}

function getTerminalBufferText(terminal: Terminal): string {
  const buffer = terminal.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buffer.length; i += 1) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
  }
  return lines.join('\n').trim()
}

const shellTerminalTheme = {
  background: '#000000',
  foreground: '#ffffff',
  cursor: '#ffffff',
  selectionBackground: '#1d4ed8',
  black: '#000000',
  brightBlack: '#64748b',
  red: '#ef4444',
  brightRed: '#f87171',
  green: '#22c55e',
  brightGreen: '#4ade80',
  yellow: '#eab308',
  brightYellow: '#facc15',
  blue: '#3b82f6',
  brightBlue: '#60a5fa',
  magenta: '#d946ef',
  brightMagenta: '#e879f9',
  cyan: '#06b6d4',
  brightCyan: '#22d3ee',
  white: '#e2e8f0',
  brightWhite: '#ffffff',
}

export default function ContainersPage() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === 'administrator'
  const [selectedContainer, setSelectedContainer] = useState<SelectedContainer | null>(null)
  const [pendingShellContainer, setPendingShellContainer] = useState<ContainerInfo | null>(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isComposeOpen, setIsComposeOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editData, setEditData] = useState<ContainerUpdatePayload | null>(null)
  const [composeContent, setComposeContent] = useState('')
  const [newComposeContent, setNewComposeContent] = useState('')
  const [isLogsOpen, setIsLogsOpen] = useState(false)
  const [logsMode, setLogsMode] = useState<'latest' | 'live' | 'fromTop'>('latest')
  const [logsContent, setLogsContent] = useState('')
  const [isShellConfirmOpen, setIsShellConfirmOpen] = useState(false)
  const [isShellOpen, setIsShellOpen] = useState(false)
  const [shellType, setShellType] = useState<'sh' | 'bash'>('sh')
  const [shellStatus, setShellStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'disconnected'
  >('idle')
  const shellSocketRef = useRef<WebSocket | null>(null)
  const terminalContainerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const {
    data: containers,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['containers'],
    queryFn: fetchContainers,
    refetchInterval: 5000,
  })

  const startMutation = useMutation({
    mutationFn: (id: string) => api.post(`/docker/containers/${id}/start`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] })
      toast.success('Container started')
    },
    onError: (error) => toast.error(extractErrorMessage(error, 'Failed to start container')),
  })

  const stopMutation = useMutation({
    mutationFn: (id: string) => api.post(`/docker/containers/${id}/stop`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] })
      toast.success('Container stopped')
    },
    onError: (error) => toast.error(extractErrorMessage(error, 'Failed to stop container')),
  })

  const restartMutation = useMutation({
    mutationFn: (id: string) => api.post(`/docker/containers/${id}/restart`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] })
      toast.success('Container restarted')
    },
    onError: (error) => toast.error(extractErrorMessage(error, 'Failed to restart container')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/docker/containers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] })
      toast.success('Container deleted')
      setIsDeleteOpen(false)
    },
    onError: (error) => toast.error(extractErrorMessage(error, 'Failed to delete container')),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ContainerUpdatePayload }) =>
      updateContainer(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] })
      toast.success('Container updated')
      setIsEditOpen(false)
    },
    onError: (error) => toast.error(extractErrorMessage(error, 'Failed to update container')),
  })

  const openDetails = async (container: ContainerInfo) => {
    try {
      setSelectedContainer(await fetchContainerDetails(container.id))
      setIsDetailsOpen(true)
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to load container details'))
    }
  }

  const openEdit = async (container: ContainerInfo) => {
    try {
      const data = await fetchContainerDetails(container.id)
      setSelectedContainer(data)
      setEditData({
        environment: data.environment || [],
        image: data.image
      })
      setIsEditOpen(true)
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to load container details'))
    }
  }

  const openCompose = async (container: ContainerInfo) => {
    if (container.started_with !== 'compose') {
      toast.error('This container was not started with docker-compose')
      return
    }
    try {
      const data = await fetchComposeContent(container.id)
      setSelectedContainer(container)
      setComposeContent(data.compose_content)
      setIsComposeOpen(true)
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to load docker-compose.yml'))
    }
  }

  const handleUpdate = () => {
    if (!selectedContainer) return
    updateMutation.mutate({
      id: selectedContainer.id,
      data: editData ?? {}
    })
  }

  const handleComposeUpdate = async () => {
    if (!selectedContainer) return
    try {
      await updateComposeContent(selectedContainer.id, {
        compose_content: composeContent
      })
      toast.success('docker-compose.yml updated and redeployed')
      setIsComposeOpen(false)
      queryClient.invalidateQueries({ queryKey: ['containers'] })
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to update docker-compose.yml'))
    }
  }

  const openLogs = async (container: ContainerInfo) => {
    try {
      setSelectedContainer(container)
      setLogsMode('latest')
      setIsLogsOpen(true)
      const { data } = await api.get(`/docker/containers/${container.id}/logs`, {
        params: { tail: 300 },
        responseType: 'text',
      })
      setLogsContent(data)
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to load logs'))
    }
  }

  const openShell = (container: ContainerInfo) => {
    if (!currentUser?.is_superuser) {
      toast.error('Container shell access is limited to superusers')
      return
    }

    setPendingShellContainer(container)
    setIsShellConfirmOpen(true)
  }

  const confirmOpenShell = () => {
    if (!pendingShellContainer) return

    const container = pendingShellContainer
    setSelectedContainer(container)
    setShellType('sh')
    setShellStatus('idle')
    if (shellSocketRef.current) {
      shellSocketRef.current.close()
      shellSocketRef.current = null
    }
    setPendingShellContainer(null)
    setIsShellConfirmOpen(false)
    setIsShellOpen(true)
  }

  const closeShellConfirm = () => {
    setIsShellConfirmOpen(false)
    setPendingShellContainer(null)
  }

  const closeShell = () => {
    if (shellSocketRef.current) {
      if (shellSocketRef.current.readyState === WebSocket.OPEN) {
        shellSocketRef.current.send(JSON.stringify({ type: 'disconnect' }))
      }
      shellSocketRef.current.close()
      shellSocketRef.current = null
    }
    setIsShellOpen(false)
    setShellStatus('idle')
    setPendingShellContainer(null)
  }

  const connectShell = () => {
    if (!selectedContainer) return
    const terminal = terminalRef.current
    if (!terminal) return

    if (shellSocketRef.current) {
      shellSocketRef.current.close()
      shellSocketRef.current = null
    }

    setShellStatus('connecting')
    terminal.reset()
    terminal.writeln(`Connecting to ${selectedContainer.name} (${selectedContainer.id}) using /bin/${shellType}...`)
    terminal.writeln('')

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const initialCols = Math.max(40, terminal.cols || 120)
    const initialRows = Math.max(10, terminal.rows || 32)
    const socket = new WebSocket(
      `${protocol}://${window.location.host}/api/docker/containers/${selectedContainer.id}/exec/ws?shell=${shellType}&cols=${initialCols}&rows=${initialRows}`
    )
    const connectTimeout = window.setTimeout(() => {
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.close()
        setShellStatus('disconnected')
        terminal.writeln('')
        terminal.writeln('[error] Shell connection timed out during WebSocket handshake.')
      }
    }, 10000)

    socket.onopen = () => {
      window.clearTimeout(connectTimeout)
      setShellStatus('connected')
      terminal.writeln('Shell session established.')
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
      terminal.focus()
    }

    socket.onmessage = (event) => {
      terminal.write(String(event.data))
    }

    socket.onerror = () => {
      window.clearTimeout(connectTimeout)
      setShellStatus('disconnected')
      terminal.writeln('')
      terminal.writeln('[error] Shell connection failed.')
    }

    socket.onclose = (event) => {
      window.clearTimeout(connectTimeout)
      shellSocketRef.current = null
      setShellStatus('disconnected')
      if (event.code !== 1000) {
        terminal.writeln('')
        terminal.writeln(`[session closed: code ${event.code || 'unknown'}]`)
      }
    }

    shellSocketRef.current = socket
  }

  const handleShellInterrupt = () => {
    if (!shellSocketRef.current || shellSocketRef.current.readyState !== WebSocket.OPEN) return
    shellSocketRef.current.send(JSON.stringify({ type: 'input', data: '\u0003' }))
  }

  const sendShellData = (data: string) => {
    if (!shellSocketRef.current || shellSocketRef.current.readyState !== WebSocket.OPEN) return
    shellSocketRef.current.send(JSON.stringify({ type: 'input', data }))
  }

  const disconnectShell = () => {
    if (!shellSocketRef.current) return
    if (shellSocketRef.current.readyState === WebSocket.OPEN) {
      shellSocketRef.current.send(JSON.stringify({ type: 'disconnect' }))
    }
    shellSocketRef.current.close()
    shellSocketRef.current = null
    setShellStatus('disconnected')
  }

  const handleCopyShellSelection = async () => {
    const selection = terminalRef.current?.getSelection() ?? ''
    if (!selection.trim()) {
      toast.error('Select shell output first')
      return
    }

    try {
      await navigator.clipboard.writeText(selection)
      toast.success('Selected shell text copied')
    } catch {
      toast.error('Failed to copy selection')
    }
  }

  const handleCopyAllShellOutput = async () => {
    const terminal = terminalRef.current
    if (!terminal) {
      toast.error('Terminal is not ready yet')
      return
    }

    const output = getTerminalBufferText(terminal)
    if (!output.trim()) {
      toast.error('No shell output to copy')
      return
    }

    try {
      await navigator.clipboard.writeText(output)
      toast.success('Shell output copied')
    } catch {
      toast.error('Failed to copy shell output')
    }
  }

  useEffect(() => {
    if (!isShellOpen || !terminalContainerRef.current || terminalRef.current) return

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"SFMono-Regular", "Menlo", "Monaco", "Cascadia Mono", "Segoe UI Mono", monospace',
      fontSize: 14,
      lineHeight: 1.35,
      convertEol: false,
      allowTransparency: false,
      theme: shellTerminalTheme,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(terminalContainerRef.current)
    fitAddon.fit()
    terminal.focus()
    terminal.options.disableStdin = shellStatus !== 'connected'
    terminal.writeln('Terminal ready. Choose a shell and connect.')

    const dataDisposable = terminal.onData((data) => {
      sendShellData(data)
    })

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (!shellSocketRef.current || shellSocketRef.current.readyState !== WebSocket.OPEN) return
      shellSocketRef.current.send(JSON.stringify({ type: 'resize', cols, rows }))
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
    })
    resizeObserver.observe(terminalContainerRef.current)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    return () => {
      dataDisposable.dispose()
      resizeDisposable.dispose()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [isShellOpen])

  useEffect(() => {
    if (!terminalRef.current || !fitAddonRef.current) return
    terminalRef.current.options.theme = shellTerminalTheme
    fitAddonRef.current.fit()
  }, [isShellOpen])

  useEffect(() => {
    if (!terminalRef.current) return
    terminalRef.current.options.disableStdin = shellStatus !== 'connected'
  }, [shellStatus])

  useEffect(() => {
    return () => {
      if (shellSocketRef.current) {
        shellSocketRef.current.close()
        shellSocketRef.current = null
      }
    }
  }, [])

interface LogsViewerProps {
  containerId: string
  mode: 'latest' | 'live' | 'fromTop'
  logs: string
  setLogs: Dispatch<SetStateAction<string>>
}

function LogsViewer({ containerId, mode, logs, setLogs }: LogsViewerProps) {
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!logRef.current) return
    if (mode === 'fromTop') {
      logRef.current.scrollTop = 0
      return
    }
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs, mode])

  useEffect(() => {
    if (mode !== 'live' || !containerId) return

    const controller = new AbortController()

    async function startStream() {
      try {
        const { data: recentLogs } = await api.get(
          `/docker/containers/${containerId}/logs`,
          {
            params: { tail: 300 },
            responseType: 'text',
          }
        )
        setLogs(recentLogs)

        // Cookies are sent automatically (withCredentials is set on the axios instance).
        // Raw fetch also sends same-origin cookies without any explicit header.
        const csrfToken = document.cookie
          .split('; ')
          .find((entry) => entry.startsWith('csrf_token='))
          ?.split('=')
          .slice(1)
          .join('=')
        const response = await fetch(
          `/api/docker/containers/${containerId}/logs/stream?tail=0`,
          {
            signal: controller.signal,
            credentials: 'include',
            cache: 'no-store',
            headers: csrfToken
              ? { 'X-CSRF-Token': decodeURIComponent(csrfToken) }
              : undefined,
          }
        )
        if (!response.ok || !response.body) {
          const text = await response.text()
          setLogs(text || 'Failed to start live log stream (not authenticated or server error).')
          return
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          setLogs((prev) =>
            (prev + chunk).split('\n').slice(-1000).join('\n')
          )
        }
      } catch {
        // Ignore abort / network errors on cleanup
      }
    }

    startStream()

    return () => {
      controller.abort()
    }
  }, [mode, containerId, setLogs])

  return (
    <div className="p-4">
      <pre
        ref={logRef}
        className="text-xs bg-muted rounded-md p-3 h-96 overflow-auto whitespace-pre-wrap"
      >
        {logs || 'No logs available.'}
      </pre>
    </div>
  )
}

  const handleCreateFromCompose = async () => {
    if (!newComposeContent.trim()) {
      toast.error('docker-compose content is required')
      return
    }
    try {
      toast.info('Creating containers from docker-compose...')
      await createFromCompose({
        compose_content: newComposeContent
      })
      toast.success('Container stack created successfully')
      setIsCreateOpen(false)
      setNewComposeContent('')
      queryClient.invalidateQueries({ queryKey: ['containers'] })
    } catch (error) {
      toast.error(extractErrorMessage(error, 'Failed to create container stack'))
    }
  }

  if (isLoading) return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-9 w-48" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-lg" />
        ))}
      </div>
    </div>
  )

  if (isError) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold">Containers</h1>
          <p className="text-muted-foreground mt-1">Manage your Docker containers</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {extractErrorMessage(error, 'Failed to load Docker containers.')}
        </div>
      </div>
    )
  }

  const selectedEnvironment = selectedContainer?.environment ?? []
  const selectedVolumes = selectedContainer?.volumes ?? []
  const selectedNetworks = selectedContainer?.networks ?? []

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Containers</h1>
          <p className="text-muted-foreground mt-1">Manage your Docker containers</p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          disabled={!isAdmin}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
        >
          <Plus size={16} />
          Create from Compose
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {containers?.map((container: ContainerInfo) => (
          <div key={container.id} className="p-4 bg-card rounded-lg border shadow-sm">
            <div className="flex justify-between items-start mb-4">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">{container.name}</h3>
                <p className="text-sm text-muted-foreground truncate">{container.image}</p>
                {container.started_with === 'compose' && (
                  <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 mt-1">
                    <FileCode size={12} />
                    compose
                  </span>
                )}
              </div>
              <span className={`px-2 py-1 rounded text-xs whitespace-nowrap ml-2 ${
                container.status === 'running'
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                  : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'
              }`}>
                {container.status}
              </span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => startMutation.mutate(container.id)}
                className="p-2 hover:bg-accent rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={!isAdmin ? 'Start is available to administrators only' : 'Start'}
                disabled={container.status === 'running' || !isAdmin}
              >
                <Play size={16} />
              </button>
              <button
                onClick={() => stopMutation.mutate(container.id)}
                className="p-2 hover:bg-accent rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={!isAdmin ? 'Stop is available to administrators only' : 'Stop'}
                disabled={container.status !== 'running' || !isAdmin}
              >
                <Square size={16} />
              </button>
              <button
                onClick={() => restartMutation.mutate(container.id)}
                className="p-2 hover:bg-accent rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={!isAdmin ? 'Restart is available to administrators only' : 'Restart'}
                disabled={!isAdmin}
              >
                <RotateCw size={16} />
              </button>
              <button
                onClick={() => openDetails(container)}
                className="p-2 hover:bg-accent rounded transition-colors"
                title="View Details"
              >
                <Eye size={16} />
              </button>
              <button
                onClick={() => openLogs(container)}
                className="p-2 hover:bg-accent rounded transition-colors"
                title="View Logs"
              >
                <FileText size={16} />
              </button>
              <button
                onClick={() => openShell(container)}
                className="rounded px-2 py-2 font-mono text-xs hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  !isAdmin
                    ? 'Shell access is limited to superusers'
                    : 'Open Shell'
                }
                disabled={container.status !== 'running' || !isAdmin}
              >
                &gt;_
              </button>
              <button
                onClick={() => openEdit(container)}
                className="p-2 hover:bg-accent rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={!isAdmin ? 'Edit is available to administrators only' : 'Edit'}
                disabled={!isAdmin}
              >
                <Edit size={16} />
              </button>
              {container.started_with === 'compose' && (
                <button
                  onClick={() => openCompose(container)}
                  className="p-2 hover:bg-accent rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={!isAdmin ? 'Compose editing is available to administrators only' : 'Edit docker-compose.yml'}
                  disabled={!isAdmin}
                >
                  <FileCode size={16} />
                </button>
              )}
              <button
                onClick={() => {
                  setSelectedContainer(container)
                  setIsDeleteOpen(true)
                }}
                className="p-2 hover:bg-red-100 dark:hover:bg-red-900 rounded transition-colors text-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!isAdmin ? 'Delete is available to administrators only' : 'Delete'}
                disabled={!isAdmin}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {containers?.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No Docker containers were returned by the backend. If you expected containers here,
          the backend may not have access to the engine inspect/list metadata for them yet.
        </div>
      )}

      {isShellConfirmOpen && pendingShellContainer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeShellConfirm}
        >
          <div
            className="w-full max-w-lg rounded-2xl border bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b p-5">
              <h2 className="text-xl font-bold">Open Container Shell?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                You are about to open an interactive shell into
                {' '}
                <span className="font-medium text-foreground">{pendingShellContainer.name}</span>.
                This is equivalent to direct container access and actions are audited server-side.
              </p>
            </div>
            <div className="space-y-3 p-5 text-sm text-muted-foreground">
              <p>Best practice reminders:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Use shell access only when logs and metadata views are not sufficient.</li>
                <li>Assume commands run with the container user&apos;s effective privileges.</li>
                <li>Disconnect when finished and avoid ad-hoc changes in production containers.</li>
              </ul>
            </div>
            <div className="flex justify-end gap-2 border-t p-5">
              <button
                onClick={closeShellConfirm}
                className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={confirmOpenShell}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
              >
                Open Shell
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shell Modal */}
      {isShellOpen && selectedContainer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeShell}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-4 border-b p-5 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-bold">Container Shell: {selectedContainer.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose a shell, connect, then run commands inside the container. `bash` may not
                  be available in every image.
                </p>
              </div>
              <div className="flex items-center gap-2 self-end md:self-auto">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    shellStatus === 'connected'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
                      : shellStatus === 'connecting'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {shellStatus}
                </span>
                <button onClick={closeShell} className="rounded p-2 hover:bg-accent">
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="space-y-4 p-5">
              <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 md:flex-row md:items-end md:justify-between">
                <div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-end">
                  <label className="text-sm font-medium">
                    Shell
                    <select
                      value={shellType}
                      onChange={(e) => setShellType(e.target.value as 'sh' | 'bash')}
                      disabled={shellStatus === 'connecting' || shellStatus === 'connected'}
                      className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <option value="sh">/bin/sh</option>
                      <option value="bash">/bin/bash</option>
                    </select>
                  </label>
                  <div className="text-sm text-muted-foreground">
                    Use this shell to inspect logs, verify environment variables, and run ad-hoc
                    commands inside the container.
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={connectShell}
                    disabled={shellStatus === 'connecting'}
                    className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {shellStatus === 'connected' ? 'Reconnect Shell' : 'Connect Shell'}
                  </button>
                  <button
                    onClick={handleShellInterrupt}
                    disabled={shellStatus !== 'connected'}
                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
                  >
                    Send Ctrl+C
                  </button>
                  <button
                    onClick={disconnectShell}
                    disabled={shellStatus !== 'connected'}
                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                  <button
                    onClick={() => terminalRef.current?.focus()}
                    disabled={shellStatus !== 'connected'}
                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
                  >
                    Focus Terminal
                  </button>
                  <button
                    onClick={() => terminalRef.current?.clear()}
                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                  >
                    Clear Output
                  </button>
                  <button
                    onClick={handleCopyShellSelection}
                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                  >
                    Copy Selection
                  </button>
                  <button
                    onClick={handleCopyAllShellOutput}
                    className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
                  >
                    Copy All
                  </button>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-700 bg-black shadow-inner">
                <div
                  ref={terminalContainerRef}
                  className="h-[520px] w-full px-3 py-2"
                />
              </div>

              <div className="rounded-xl border bg-card p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium">Interactive Terminal</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      This uses an `xterm.js` terminal surface, so cursor movement, ANSI color,
                      shell prompts, selection, and scrolling behave much closer to a direct
                      `docker exec -it` session.
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Click the terminal pane to focus it, then type normally. Standard terminal copy
                  and selection behavior is supported, and `Ctrl+C` is forwarded to the container.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Security note: shell access runs commands with the container user&apos;s privileges.
                  Treat it like direct production access and disconnect when finished.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Logs Modal */}
      {isLogsOpen && selectedContainer && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setIsLogsOpen(false)}
        >
          <div
            className="bg-background rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-background border-b p-4 flex justify-between items-center">
              <div className="flex flex-col">
                <h2 className="text-xl font-bold">
                  Logs: {selectedContainer.name}
                </h2>
                <span className="text-xs text-muted-foreground">
                  Container ID: {selectedContainer.id}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 text-xs">
                  <button
                    className={`px-2 py-1 rounded border ${
                      logsMode === 'latest' ? 'bg-accent' : ''
                    }`}
                    onClick={async () => {
                      setLogsMode('latest')
                      try {
                        const { data } = await api.get(
                          `/docker/containers/${selectedContainer.id}/logs`,
                          {
                            params: { tail: 300 },
                            responseType: 'text',
                          }
                        )
                        setLogsContent(data)
                      } catch (error) {
                        toast.error(extractErrorMessage(error, 'Failed to load logs'))
                      }
                    }}
                  >
                    Latest
                  </button>
                  <button
                    className={`px-2 py-1 rounded border ${
                      logsMode === 'fromTop' ? 'bg-accent' : ''
                    }`}
                    onClick={async () => {
                      setLogsMode('fromTop')
                      try {
                        const { data } = await api.get(
                          `/docker/containers/${selectedContainer.id}/logs`,
                          {
                            params: { fromTop: true },
                            responseType: 'text',
                          }
                        )
                        setLogsContent(data)
                      } catch (error) {
                        toast.error(extractErrorMessage(error, 'Failed to load logs'))
                      }
                    }}
                  >
                    From top
                  </button>
                  <button
                    className={`px-2 py-1 rounded border ${
                      logsMode === 'live' ? 'bg-accent' : ''
                    }`}
                    onClick={() => {
                      setLogsContent('')
                      setLogsMode('live')
                    }}
                  >
                    Live tail
                  </button>
                </div>
                <button
                  onClick={() => setIsLogsOpen(false)}
                  className="p-2 hover:bg-accent rounded"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <LogsViewer
              containerId={selectedContainer.id}
              mode={logsMode}
              logs={logsContent}
              setLogs={setLogsContent}
            />
          </div>
        </div>
      )}

      {/* Details Modal */}
      {isDetailsOpen && selectedContainer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsDetailsOpen(false)}>
          <div className="bg-background rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b p-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">Container Details: {selectedContainer.name}</h2>
              <button onClick={() => setIsDetailsOpen(false)} className="p-2 hover:bg-accent rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <h3 className="font-semibold text-lg mb-2">Basic Info</h3>
                <div className="space-y-2 text-sm">
                  <div><span className="text-muted-foreground">ID:</span> <span className="font-mono">{selectedContainer.id}</span></div>
                  <div><span className="text-muted-foreground">Image:</span> {selectedContainer.image}</div>
                  <div><span className="text-muted-foreground">Status:</span> {selectedContainer.status}</div>
                  <div><span className="text-muted-foreground">Created:</span> {selectedContainer.created}</div>
                </div>
              </div>

              {selectedEnvironment.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-2">Environment Variables</h3>
                  <div className="bg-muted p-3 rounded font-mono text-sm space-y-1">
                    {selectedEnvironment.map((env: string, i: number) => (
                      <div key={i}>{env}</div>
                    ))}
                  </div>
                </div>
              )}

              {selectedContainer.ports && Object.keys(selectedContainer.ports).length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-2">Ports</h3>
                  <div className="bg-muted p-3 rounded font-mono text-sm space-y-1">
                    {Object.entries(selectedContainer.ports).map(([key, value]) => (
                      <div key={key}>{key} → {JSON.stringify(value)}</div>
                    ))}
                  </div>
                </div>
              )}

              {selectedVolumes.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-2">Volumes</h3>
                  <div className="space-y-2">
                    {selectedVolumes.map((vol, i: number) => (
                      <div key={i} className="bg-muted p-3 rounded text-sm">
                        <div><span className="text-muted-foreground">Type:</span> {vol.type}</div>
                        <div><span className="text-muted-foreground">Source:</span> <span className="font-mono">{vol.source}</span></div>
                        <div><span className="text-muted-foreground">Destination:</span> <span className="font-mono">{vol.destination}</span></div>
                        <div><span className="text-muted-foreground">Mode:</span> {vol.mode}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedNetworks.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-2">Networks</h3>
                  <div className="bg-muted p-3 rounded font-mono text-sm space-y-1">
                    {selectedNetworks.map((net: string, i: number) => (
                      <div key={i}>{net}</div>
                    ))}
                  </div>
                </div>
              )}

              {selectedContainer.labels && Object.keys(selectedContainer.labels).length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-2">Labels</h3>
                  <div className="bg-muted p-3 rounded font-mono text-sm space-y-1 max-h-48 overflow-y-auto">
                    {Object.entries(selectedContainer.labels).map(([key, value]) => (
                      <div key={key}>{key}: {value}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isEditOpen && selectedContainer && editData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsEditOpen(false)}>
          <div className="bg-background rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b p-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">Edit Container: {selectedContainer.name}</h2>
              <button onClick={() => setIsEditOpen(false)} className="p-2 hover:bg-accent rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2">Docker Image</label>
                <input
                  type="text"
                  value={editData.image}
                  onChange={(e) => setEditData({ ...editData, image: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                  placeholder="nginx:latest"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium">Environment Variables</label>
                  <button
                    onClick={() =>
                      setEditData({
                        ...editData,
                        environment: [...(editData.environment ?? []), 'KEY=value'],
                      })
                    }
                    className="text-sm px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90"
                  >
                    <Plus size={14} className="inline" /> Add
                  </button>
                </div>
                <div className="space-y-2">
                  {(editData.environment ?? []).map((env: string, i: number) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="text"
                        value={env}
                        onChange={(e) => {
                          const newEnv = [...(editData.environment ?? [])]
                          newEnv[i] = e.target.value
                          setEditData({ ...editData, environment: newEnv })
                        }}
                        className="flex-1 px-3 py-2 border rounded-md bg-background font-mono text-sm"
                      />
                      <button
                        onClick={() => {
                          const newEnv = editData.environment?.filter((_, idx: number) => idx !== i) ?? []
                          setEditData({ ...editData, environment: newEnv })
                        }}
                        className="p-2 hover:bg-red-100 dark:hover:bg-red-900 rounded text-red-600"
                      >
                        <Minus size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t">
                <button
                  onClick={() => setIsEditOpen(false)}
                  className="px-4 py-2 border rounded hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdate}
                  disabled={updateMutation.isPending}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                >
                  {updateMutation.isPending ? 'Updating...' : 'Update & Redeploy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compose Editor Modal */}
      {isComposeOpen && selectedContainer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsComposeOpen(false)}>
          <div className="bg-background rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b p-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">Edit docker-compose.yml: {selectedContainer.name}</h2>
              <button onClick={() => setIsComposeOpen(false)} className="p-2 hover:bg-accent rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <textarea
                value={composeContent}
                onChange={(e) => setComposeContent(e.target.value)}
                className="w-full h-96 px-3 py-2 border rounded-md bg-background font-mono text-sm"
                placeholder="version: '3.8'\nservices:\n  app:\n    image: nginx\n    ..."
              />
              <div className="flex gap-2 justify-end pt-4 border-t">
                <button
                  onClick={() => setIsComposeOpen(false)}
                  className="px-4 py-2 border rounded hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={handleComposeUpdate}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
                >
                  Save & Redeploy
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create from Compose Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsCreateOpen(false)}>
          <div className="bg-background rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b p-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">Create Container Stack from docker-compose</h2>
              <button onClick={() => setIsCreateOpen(false)} className="p-2 hover:bg-accent rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                Paste your docker-compose.yml content below to create a container stack.
              </p>
              <textarea
                value={newComposeContent}
                onChange={(e) => setNewComposeContent(e.target.value)}
                className="w-full h-96 px-3 py-2 border rounded-md bg-background font-mono text-sm"
                placeholder={`version: '3.8'\nservices:\n  app:\n    image: nginx:latest\n    ports:\n      - "80:80"\n    ...`}
              />
              <div className="flex gap-2 justify-end pt-4 border-t">
                <button
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 border rounded hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFromCompose}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
                >
                  Create Stack
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteOpen && selectedContainer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsDeleteOpen(false)}>
          <div className="bg-background rounded-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <h2 className="text-xl font-bold">Delete Container?</h2>
              <p className="text-muted-foreground">
                Are you sure you want to delete container <strong>{selectedContainer.name}</strong>? This action cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setIsDeleteOpen(false)}
                  className="px-4 py-2 border rounded hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMutation.mutate(selectedContainer.id)}
                  disabled={deleteMutation.isPending}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
