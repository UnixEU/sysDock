export type UserRole = 'administrator' | 'viewer'

export interface UserInfo {
  id: number
  username: string
  email: string
  full_name?: string
  role: UserRole
  is_active: boolean
  is_superuser: boolean
  created_at: string
  updated_at?: string | null
}

export interface DockerSystemDfBucket {
  count: number
  total_size: number
  reclaimable: number
}

export interface DockerSystemDf {
  images: DockerSystemDfBucket
  containers: DockerSystemDfBucket
  volumes: DockerSystemDfBucket
  build_cache: DockerSystemDfBucket
}

export interface DockerSystemInfo {
  containers_running: number
  containers_stopped: number
  containers_exited: number
  containers_created: number
  containers_paused: number
  containers_total: number
  images_count: number
  volumes_count: number
  networks_count: number
  docker_version: string
  server_version: string
  total_cpu_percent: number
  total_memory_bytes: number
  total_memory_mb: number
  host_memory_bytes: number
  host_memory_mb: number
  system_df: DockerSystemDf
}

export interface ResourceMetricPoint {
  timestamp: string
  cpu_percent: number
  memory_mb: number
}

export interface ResourceHistory {
  points: ResourceMetricPoint[]
}

export interface ContainerInfo {
  id: string
  name: string
  image: string
  status: string
  state: string
  created: string
  started_with: 'run' | 'compose'
}

export interface ContainerVolume {
  source: string
  destination: string
  mode: string
  type: string
}

export interface ContainerDetail extends ContainerInfo {
  ports: Record<string, unknown>
  volumes: ContainerVolume[]
  networks: string[]
  environment: string[]
  labels: Record<string, string>
}

export interface ContainerUpdatePayload {
  image?: string
  environment?: string[]
}

export interface ComposePayload {
  compose_content: string
}

export interface NetworkInfo {
  id: string
  name: string
  driver: string
  scope: string
}

export interface NetworkContainer {
  id: string
  name: string
  image: string
  endpoint_id?: string
  mac_address?: string
  ipv4_address?: string
  ipv6_address?: string
}

export interface NetworkDetail extends NetworkInfo {
  subnet?: string
  gateway?: string
  ip_range?: string
  containers: NetworkContainer[]
}

export interface NetworkCreatePayload {
  name: string
  driver: string
}

export interface VolumeInfo {
  name: string
  driver: string
  mountpoint: string
  host_path: string
  is_bind_mount: boolean
}

export interface VolumeContainer {
  id: string
  name: string
  image: string
  destination: string
}

export interface BindUsageEntry {
  name: string
  path: string
  size_bytes: number
  size_human: string
}

export interface BindUsage {
  accessible: boolean
  total_bytes?: number
  total_human?: string
  entries: BindUsageEntry[]
}

export interface VolumeDetail extends VolumeInfo {
  created_at?: string
  size_bytes?: number | null
  size_human?: string | null
  containers: VolumeContainer[]
  bind_usage?: BindUsage | null
}

export interface VolumeCreatePayload {
  name: string
  driver: string
  host_path?: string
}

export interface ImageInfo {
  id: string
  tags: string[]
  size: number
  created: string
}

export interface BuildImagePayload {
  dockerfile_content: string
  tag: string
}

export type MaintenanceAction = 'images' | 'volumes' | 'builder' | 'system'

export interface MaintenancePrunePayload {
  force: boolean
}

export interface MaintenanceActionResult {
  status: string
  action: string
  command: string
  message: string
  output: string
  space_reclaimed?: number
  details?: Record<string, unknown>
  images_deleted?: unknown[]
  volumes_deleted?: string[]
  caches_deleted?: unknown[]
}
