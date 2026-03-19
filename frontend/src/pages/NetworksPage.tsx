import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { createNetwork, fetchContainers, fetchNetworkDetails, fetchNetworks } from '@/lib/dockerApi'
import { toast } from 'sonner'
import { Plus, X, Network as NetworkIcon, Link, Unlink } from 'lucide-react'
import axios from 'axios'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuthStore } from '@/stores/authStore'
import type { ContainerInfo, NetworkCreatePayload, NetworkDetail, NetworkInfo } from '@/types/api'

const LIMIT = 50

export default function NetworksPage() {
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)
  const isAdmin = currentUser?.role === 'administrator'
  const [page, setPage] = useState(0)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkDetail | null>(null)
  const [newNetwork, setNewNetwork] = useState<NetworkCreatePayload>({
    name: '',
    driver: 'bridge'
  })

  const { data: networks, isLoading } = useQuery({
    queryKey: ['networks', page],
    queryFn: async () => {
      return fetchNetworks(page * LIMIT, LIMIT)
    },
  })

  const { data: allContainers } = useQuery<ContainerInfo[]>({
    queryKey: ['containers'],
    queryFn: fetchContainers,
  })

  const createMutation = useMutation({
    mutationFn: (payload: NetworkCreatePayload) => createNetwork(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['networks'] })
      toast.success('Network created')
      setIsCreateOpen(false)
      setNewNetwork({ name: '', driver: 'bridge' })
    },
    onError: () => {
      toast.error('Failed to create network')
    }
  })

  const connectMutation = useMutation({
    mutationFn: ({ networkId, containerId }: { networkId: string; containerId: string }) =>
      api.post(`/docker/containers/${containerId}/networks/${networkId}`),
    onSuccess: () => {
      toast.success('Container connected to network')
      queryClient.invalidateQueries({ queryKey: ['networks'] })
      queryClient.invalidateQueries({ queryKey: ['containers'] })
      if (selectedNetwork) {
        loadNetworkDetails(selectedNetwork.id)
      }
    },
    onError: () => {
      toast.error('Failed to connect container')
    }
  })

  const disconnectMutation = useMutation({
    mutationFn: ({ networkId, containerId }: { networkId: string; containerId: string }) =>
      api.delete(`/docker/containers/${containerId}/networks/${networkId}`),
    onSuccess: () => {
      toast.success('Container disconnected from network')
      queryClient.invalidateQueries({ queryKey: ['networks'] })
      queryClient.invalidateQueries({ queryKey: ['containers'] })
      if (selectedNetwork) {
        loadNetworkDetails(selectedNetwork.id)
      }
    },
    onError: () => {
      toast.error('Failed to disconnect container')
    }
  })

  const loadNetworkDetails = async (networkId: string) => {
    try {
      setSelectedNetwork(await fetchNetworkDetails(networkId))
      setIsDetailsOpen(true)
    } catch (error) {
      toast.error('Failed to load network details')
    }
  }

  const handleCreateNetwork = () => {
    if (!newNetwork.name) {
      toast.error('Network name is required')
      return
    }
    createMutation.mutate(newNetwork)
  }

  if (isLoading) return (
    <div className="space-y-6 p-6">
      <Skeleton className="h-9 w-36" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Networks</h1>
          <p className="text-muted-foreground mt-1">Manage Docker networks</p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          disabled={!isAdmin}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
        >
          <Plus size={16} />
          Create Network
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {networks?.map((network: NetworkInfo) => (
          <div
            key={network.id}
            className="p-4 bg-card rounded-lg border shadow-sm hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => loadNetworkDetails(network.id)}
          >
            <div className="flex items-start gap-3">
              <NetworkIcon className="h-5 w-5 text-primary mt-1" />
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold truncate">{network.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">Driver: {network.driver}</p>
                <p className="text-sm text-muted-foreground">Scope: {network.scope}</p>
              </div>
            </div>
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
          disabled={!networks || networks.length < LIMIT}
          onClick={() => setPage(p => p + 1)}
          className="px-3 py-1 text-sm border rounded hover:bg-accent disabled:opacity-50"
        >
          Next
        </button>
      </div>

      {/* Create Network Modal */}
      {isCreateOpen && isAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsCreateOpen(false)}>
          <div className="bg-background rounded-lg max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="border-b p-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">Create Network</h2>
              <button onClick={() => setIsCreateOpen(false)} className="p-2 hover:bg-accent rounded">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Network Name *</label>
                <input
                  type="text"
                  value={newNetwork.name}
                  onChange={(e) => setNewNetwork({ ...newNetwork, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                  placeholder="my-network"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Driver</label>
                <select
                  value={newNetwork.driver}
                  onChange={(e) => setNewNetwork({ ...newNetwork, driver: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md bg-background"
                >
                  <option value="bridge">bridge</option>
                  <option value="host">host</option>
                  <option value="overlay">overlay</option>
                  <option value="macvlan">macvlan</option>
                  <option value="none">none</option>
                </select>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t">
                <button
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 border rounded hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateNetwork}
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

      {/* Network Details Modal */}
      {isDetailsOpen && selectedNetwork && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsDetailsOpen(false)}>
          <div className="bg-background rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-background border-b p-4 flex justify-between items-center">
              <h2 className="text-xl font-bold">Network: {selectedNetwork.name}</h2>
              <div className="flex items-center gap-3">
                {isAdmin ? (
                  <button
                    onClick={async () => {
                      try {
                        if (selectedNetwork.containers?.length) {
                          toast.error('Disconnect all containers before deleting this network.')
                          return
                        }
                        await api.delete(`/docker/networks/${selectedNetwork.id}`)
                        toast.success('Network deleted')
                        setIsDetailsOpen(false)
                        queryClient.invalidateQueries({ queryKey: ['networks'] })
                      } catch (error) {
                        const detail = axios.isAxiosError(error)
                          ? error.response?.data?.detail ?? error.message
                          : 'Failed to delete network'
                        toast.error(detail)
                      }
                    }}
                    disabled={!!selectedNetwork.containers?.length}
                    className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                  >
                    Delete
                  </button>
                ) : null}
                <button onClick={() => setIsDetailsOpen(false)} className="p-2 hover:bg-accent rounded">
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <h3 className="font-semibold text-lg mb-2">Details</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">ID:</span>{' '}
                    <span className="font-mono">{selectedNetwork.id}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Driver:</span>{' '}
                    {selectedNetwork.driver}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Scope:</span>{' '}
                    {selectedNetwork.scope}
                  </div>
                  {selectedNetwork.subnet && (
                    <div>
                      <span className="text-muted-foreground">Subnet:</span>{' '}
                      <span className="font-mono">{selectedNetwork.subnet}</span>
                    </div>
                  )}
                  {selectedNetwork.gateway && (
                    <div>
                      <span className="text-muted-foreground">Gateway:</span>{' '}
                      <span className="font-mono">{selectedNetwork.gateway}</span>
                    </div>
                  )}
                  {selectedNetwork.ip_range && (
                    <div>
                      <span className="text-muted-foreground">IP Range:</span>{' '}
                      <span className="font-mono">{selectedNetwork.ip_range}</span>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-lg mb-3">Connected Containers</h3>
                {selectedNetwork.containers && selectedNetwork.containers.length > 0 ? (
                  <div className="space-y-2">
                    {selectedNetwork.containers.map((container) => (
                      <div key={container.id} className="flex justify-between items-center p-3 bg-muted rounded">
                        <div>
                          <div className="font-medium">{container.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {container.image}
                          </div>
                          {(container.ipv4_address || container.ipv6_address) && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {container.ipv4_address && (
                                <span className="mr-2">
                                  IPv4: {container.ipv4_address}
                                </span>
                              )}
                              {container.ipv6_address && (
                                <span>IPv6: {container.ipv6_address}</span>
                              )}
                            </div>
                          )}
                        </div>
                        {isAdmin ? (
                          <button
                            onClick={() => disconnectMutation.mutate({
                              networkId: selectedNetwork.id,
                              containerId: container.id
                            })}
                            disabled={disconnectMutation.isPending}
                            className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
                          >
                            <Unlink size={14} />
                            Disconnect
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No containers connected</p>
                )}
              </div>

              {isAdmin ? (
              <div>
                <h3 className="font-semibold text-lg mb-3">Connect Container</h3>
                <div className="space-y-2">
                  {allContainers?.filter((container) =>
                    !selectedNetwork.containers?.some((networkContainer) => networkContainer.id === container.id)
                  ).map((container) => (
                    <div key={container.id} className="flex justify-between items-center p-3 bg-muted rounded">
                      <div>
                        <div className="font-medium">{container.name}</div>
                        <div className="text-sm text-muted-foreground">{container.image}</div>
                      </div>
                      <button
                        onClick={() => connectMutation.mutate({
                          networkId: selectedNetwork.id,
                          containerId: container.id
                        })}
                        disabled={connectMutation.isPending}
                        className="px-3 py-1 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                      >
                        <Link size={14} />
                        Connect
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
