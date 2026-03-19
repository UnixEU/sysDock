import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { createVolume, fetchVolumeDetails, fetchVolumes } from '@/lib/dockerApi'
import { toast } from 'sonner'
import { Plus, Trash2, X, HardDrive } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuthStore } from '@/stores/authStore'
import type { BindUsageEntry, VolumeCreatePayload, VolumeDetail, VolumeInfo } from '@/types/api'

const LIMIT = 50

export default function VolumesPage() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === 'administrator'
  const [page, setPage] = useState(0)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [selectedVolume, setSelectedVolume] = useState<VolumeInfo | null>(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [volumeDetails, setVolumeDetails] = useState<VolumeDetail | null>(null)
  const [newVolume, setNewVolume] = useState<VolumeCreatePayload>({
    name: '',
    driver: 'local',
    host_path: ''
  })
  const [volumeType, setVolumeType] = useState<'named' | 'bind'>('named')

  const { data: volumes, isLoading } = useQuery({
    queryKey: ['volumes', page],
    queryFn: async () => {
      return fetchVolumes(page * LIMIT, LIMIT)
    },
  })

  const createMutation = useMutation({
    mutationFn: (payload: VolumeCreatePayload) => createVolume(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['volumes'] })
      toast.success('Volume created')
      setIsCreateOpen(false)
      setNewVolume({ name: '', driver: 'local', host_path: '' })
      setVolumeType('named')
    },
    onError: () => {
      toast.error('Failed to create volume')
    }
  })

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.delete(`/docker/volumes/${name}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['volumes'] })
      toast.success('Volume deleted')
      setIsDeleteOpen(false)
    },
    onError: () => {
      toast.error('Failed to delete volume')
    }
  })

  const openDetails = async (volume: VolumeInfo) => {
    try {
      setVolumeDetails(await fetchVolumeDetails(volume.name))
      setIsDetailsOpen(true)
    } catch {
      toast.error('Failed to load volume details')
    }
  }

  const formatBytes = (bytes: number | null | undefined) => {
    if (bytes === null || bytes === undefined) return 'Unknown'
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    const value = bytes / Math.pow(k, i)
    return `${value.toFixed(2)} ${sizes[i]}`
  }

  const handleCreateVolume = () => {
    if (!newVolume.name) {
      toast.error('Volume name is required')
      return
    }
    if (volumeType === 'bind' && !newVolume.host_path) {
      toast.error('Host path is required for bind mounts')
      return
    }

    const volumeData = volumeType === 'bind'
      ? { ...newVolume, host_path: newVolume.host_path }
      : { name: newVolume.name, driver: newVolume.driver }

    createMutation.mutate(volumeData)
  }

  if (isLoading) return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-9 w-36" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-lg" />
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Volumes</h1>
          <p className="text-muted-foreground mt-1">Manage Docker volumes</p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          disabled={!isAdmin}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
        >
          <Plus size={16} />
          Create Volume
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {volumes?.map((volume: VolumeInfo) => (
          <div
            key={volume.name}
            className="p-4 bg-card rounded-lg border shadow-sm hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => openDetails(volume)}
          >
            <div className="flex items-start gap-3 mb-3">
              <HardDrive className="h-5 w-5 text-primary mt-1" />
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">{volume.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">Driver: {volume.driver}</p>
                {volume.is_bind_mount && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    Bind Mount
                  </p>
                )}
              </div>
            </div>
            {volume.host_path ? (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Host Path:</p>
                <p className="text-xs font-mono bg-muted px-2 py-1 rounded truncate" title={volume.host_path}>
                  {volume.host_path}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground truncate" title={volume.mountpoint}>
                {volume.mountpoint}
              </p>
            )}
            {isAdmin ? (
              <div className="mt-3 flex justify-end">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedVolume(volume)
                    setIsDeleteOpen(true)
                  }}
                  className="p-2 hover:bg-red-100 dark:hover:bg-red-900 rounded transition-colors text-red-600"
                  title="Delete Volume"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          disabled={page === 0}
          onClick={() => setPage(p => p - 1)}
          className="px-3 py-1 text-sm border rounded hover:bg-accent disabled:opacity-50"
        >
          Previous
        </button>
        <span className="text-sm text-muted-foreground">Page {page + 1}</span>
        <button
          disabled={!volumes || volumes.length < LIMIT}
          onClick={() => setPage(p => p + 1)}
          className="px-3 py-1 text-sm border rounded hover:bg-accent disabled:opacity-50"
        >
          Next
        </button>
      </div>

      {/* Create Volume Modal */}
      {isCreateOpen && isAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsCreateOpen(false)}>
          <div className="bg-background rounded-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="border-b p-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">Create Volume</h2>
              <button onClick={() => setIsCreateOpen(false)} className="p-2 hover:bg-accent rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Volume Type *</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="named"
                      checked={volumeType === 'named'}
                      onChange={(e) => setVolumeType(e.target.value as 'named' | 'bind')}
                      className="cursor-pointer"
                    />
                    <span>Named Volume</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="bind"
                      checked={volumeType === 'bind'}
                      onChange={(e) => setVolumeType(e.target.value as 'named' | 'bind')}
                      className="cursor-pointer"
                    />
                    <span>Bind Mount (Host Path)</span>
                  </label>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {volumeType === 'named'
                    ? 'Named volumes are managed by Docker and stored in Docker\'s storage directory'
                    : 'Bind mounts link a host directory to a container path'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Volume Name *</label>
                <input
                  type="text"
                  value={newVolume.name}
                  onChange={(e) => setNewVolume({ ...newVolume, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                  placeholder="my-volume"
                />
              </div>

              {volumeType === 'bind' && (
                <div>
                  <label className="block text-sm font-medium mb-2">Host Path *</label>
                  <input
                    type="text"
                    value={newVolume.host_path}
                    onChange={(e) => setNewVolume({ ...newVolume, host_path: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md bg-background font-mono text-sm"
                    placeholder="/path/on/host"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Absolute path to the directory on the host system
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-2">Driver</label>
                <select
                  value={newVolume.driver}
                  onChange={(e) => setNewVolume({ ...newVolume, driver: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                >
                  <option value="local">local</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  Local driver stores volume data on the Docker host
                </p>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t">
                <button
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 border rounded hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateVolume}
                  disabled={createMutation.isPending}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteOpen && selectedVolume && isAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsDeleteOpen(false)}>
          <div className="bg-background rounded-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <h2 className="text-xl font-bold">Delete Volume?</h2>
              <p className="text-muted-foreground">
                Are you sure you want to delete volume <strong>{selectedVolume.name}</strong>?
              </p>
              <div className="bg-muted p-3 rounded text-sm">
                <div><span className="text-muted-foreground">Name:</span> {selectedVolume.name}</div>
                <div><span className="text-muted-foreground">Driver:</span> {selectedVolume.driver}</div>
                <div className="text-xs text-muted-foreground mt-1 break-all">{selectedVolume.mountpoint}</div>
              </div>
              <p className="text-sm text-red-600">This action cannot be undone. All data in this volume will be lost.</p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setIsDeleteOpen(false)}
                  className="px-4 py-2 border rounded hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMutation.mutate(selectedVolume.name)}
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

      {/* Volume Details Modal */}
      {isDetailsOpen && volumeDetails && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setIsDetailsOpen(false)}
        >
          <div
            className="bg-background rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-background border-b p-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">Volume: {volumeDetails.name}</h2>
              <button
                onClick={() => setIsDetailsOpen(false)}
                className="p-2 hover:bg-accent rounded"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <h3 className="font-semibold text-lg mb-2">Details</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Driver:</span>{' '}
                    {volumeDetails.driver}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Mountpoint:</span>{' '}
                    <span className="font-mono break-all">
                      {volumeDetails.mountpoint}
                    </span>
                  </div>
                  {volumeDetails.host_path && (
                    <div>
                      <span className="text-muted-foreground">Host Path:</span>{' '}
                      <span className="font-mono break-all">
                        {volumeDetails.host_path}
                      </span>
                    </div>
                  )}
                  {volumeDetails.created_at && (
                    <div>
                      <span className="text-muted-foreground">Created:</span>{' '}
                      {new Date(volumeDetails.created_at).toLocaleString()}
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Disk Usage:</span>{' '}
                    {volumeDetails.size_human || formatBytes(volumeDetails.size_bytes)}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-lg mb-3">Containers Using This Volume</h3>
                {volumeDetails.containers && volumeDetails.containers.length > 0 ? (
                  <div className="space-y-2">
                    {volumeDetails.containers.map((container) => (
                      <div
                        key={container.id}
                        className="flex justify-between items-center p-3 bg-muted rounded"
                      >
                        <div>
                          <div className="font-medium">{container.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {container.image}
                          </div>
                          {container.destination && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Mount point in container:{' '}
                              <span className="font-mono">{container.destination}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No containers currently using this volume.
                  </p>
                )}
              </div>

              {volumeDetails.is_bind_mount && volumeDetails.bind_usage && (
                <div>
                  <h3 className="font-semibold text-lg mb-3">
                    Bind Mount Usage (host path)
                  </h3>
                  {volumeDetails.bind_usage.accessible ? (
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Total:</span>{' '}
                        {volumeDetails.bind_usage.total_human ||
                          formatBytes(volumeDetails.bind_usage.total_bytes)}
                      </div>
                      {volumeDetails.bind_usage.entries &&
                        volumeDetails.bind_usage.entries.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs text-muted-foreground mb-1">
                              Approximate usage per entry (like <code>du -h --max-depth=1</code>
                              ):
                            </p>
                            <div className="bg-muted rounded p-2 max-h-60 overflow-y-auto text-xs">
                              {volumeDetails.bind_usage.entries.map((entry: BindUsageEntry) => (
                                <div
                                  key={entry.path}
                                  className="flex justify-between gap-4"
                                >
                                  <span className="font-mono truncate">
                                    {entry.name}
                                  </span>
                                  <span>{entry.size_human}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Host path is not accessible from this backend container, so disk usage
                      cannot be calculated.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
