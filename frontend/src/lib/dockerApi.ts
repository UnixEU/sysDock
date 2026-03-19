import api from '@/lib/api'
import type {
  BuildImagePayload,
  ComposePayload,
  ContainerDetail,
  ContainerInfo,
  ContainerUpdatePayload,
  DockerSystemInfo,
  ImageInfo,
  MaintenanceAction,
  MaintenanceActionResult,
  MaintenancePrunePayload,
  NetworkCreatePayload,
  NetworkDetail,
  NetworkInfo,
  ResourceHistory,
  VolumeCreatePayload,
  VolumeDetail,
  VolumeInfo,
} from '@/types/api'

export async function fetchSystemInfo(realtime = true): Promise<DockerSystemInfo> {
  const { data } = await api.get('/docker/system', {
    params: { realtime },
  })
  return data
}

export async function fetchSystemHistory(window: string): Promise<ResourceHistory> {
  const { data } = await api.get('/docker/system/history', {
    params: { window },
  })
  return data
}

export async function fetchContainers(): Promise<ContainerInfo[]> {
  const { data } = await api.get('/docker/containers')
  return data
}

export async function fetchContainerDetails(containerId: string): Promise<ContainerDetail> {
  const { data } = await api.get(`/docker/containers/${containerId}`)
  return data
}

export async function fetchComposeContent(containerId: string): Promise<ComposePayload> {
  const { data } = await api.get(`/docker/containers/${containerId}/compose`)
  return data
}

export async function updateComposeContent(containerId: string, payload: ComposePayload) {
  return api.put(`/docker/containers/${containerId}/compose`, payload)
}

export async function createFromCompose(payload: ComposePayload) {
  return api.post('/docker/compose/up', payload)
}

export async function updateContainer(containerId: string, payload: ContainerUpdatePayload) {
  return api.put(`/docker/containers/${containerId}`, payload)
}

export async function fetchNetworks(skip: number, limit: number): Promise<NetworkInfo[]> {
  const { data } = await api.get('/docker/networks', {
    params: { skip, limit },
  })
  return data
}

export async function fetchNetworkDetails(networkId: string): Promise<NetworkDetail> {
  const { data } = await api.get(`/docker/networks/${networkId}`)
  return data
}

export async function createNetwork(payload: NetworkCreatePayload) {
  return api.post('/docker/networks', payload)
}

export async function fetchVolumes(skip: number, limit: number): Promise<VolumeInfo[]> {
  const { data } = await api.get('/docker/volumes', {
    params: { skip, limit },
  })
  return data
}

export async function fetchVolumeDetails(volumeName: string): Promise<VolumeDetail> {
  const { data } = await api.get(`/docker/volumes/${volumeName}`)
  return data
}

export async function createVolume(payload: VolumeCreatePayload) {
  return api.post('/docker/volumes', payload)
}

export async function fetchImages(skip: number, limit: number): Promise<ImageInfo[]> {
  const { data } = await api.get('/docker/images', {
    params: { skip, limit },
  })
  return data
}

export async function buildImage(payload: BuildImagePayload) {
  return api.post('/docker/images/build', payload)
}

export async function runMaintenancePrune(
  action: MaintenanceAction,
  payload: MaintenancePrunePayload
): Promise<MaintenanceActionResult> {
  const endpointMap: Record<MaintenanceAction, string> = {
    images: '/docker/images/prune',
    volumes: '/docker/maintenance/prune/volumes',
    builder: '/docker/maintenance/prune/builder',
    system: '/docker/maintenance/prune/system',
  }

  const body = action === 'images' ? { dangling_only: !payload.force } : payload
  const { data } = await api.post(endpointMap[action], body)
  return data
}
