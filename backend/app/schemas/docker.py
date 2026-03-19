from datetime import datetime
from pydantic import BaseModel
from typing import Optional, Dict, List, Any


class ContainerInfo(BaseModel):
    id: str
    name: str
    image: str
    status: str
    state: str
    created: str
    started_with: str  # 'run' or 'compose'


class ContainerDetail(BaseModel):
    id: str
    name: str
    image: str
    status: str
    state: str
    created: str
    ports: Dict[str, Any]
    volumes: List[Dict[str, str]]
    networks: List[str]
    environment: List[str]
    labels: Dict[str, str]
    started_with: str


class ContainerUpdate(BaseModel):
    image: Optional[str] = None
    environment: Optional[List[str]] = None
    volumes: Optional[List[str]] = None
    networks: Optional[List[str]] = None
    ports: Optional[Dict[str, Any]] = None


class NetworkCreate(BaseModel):
    name: str
    driver: str = "bridge"
    options: Optional[Dict[str, str]] = None


class VolumeCreate(BaseModel):
    name: str
    driver: str = "local"
    options: Optional[Dict[str, str]] = None
    host_path: Optional[str] = None  # For bind mounts


class ImageExport(BaseModel):
    image_name: str
    tag: str = "latest"


class ComposeUpdate(BaseModel):
    compose_content: str


class ComposeCreate(BaseModel):
    compose_content: str


class ImageBuild(BaseModel):
    dockerfile_content: str
    tag: str


class DockerSystemInfo(BaseModel):
    containers_running: int
    containers_stopped: int
    containers_exited: int
    containers_created: int
    containers_paused: int
    containers_total: int
    images_count: int
    volumes_count: int
    networks_count: int
    docker_version: str
    server_version: str
    total_cpu_percent: float
    total_memory_bytes: int
    total_memory_mb: float
    host_memory_bytes: int
    host_memory_mb: float
    system_df: Dict[str, Any]


class ResourceMetricPoint(BaseModel):
    timestamp: datetime
    cpu_percent: float
    memory_mb: float


class ResourceHistory(BaseModel):
    points: List[ResourceMetricPoint]


class ContainerRename(BaseModel):
    new_name: str


class ImageTag(BaseModel):
    repository: str
    tag: str = "latest"


class ImagePull(BaseModel):
    repository: str
    tag: str = "latest"


class ImagePush(BaseModel):
    repository: str
    tag: str = "latest"


class ImageDelete(BaseModel):
    force: bool = False


class ImagePrune(BaseModel):
    dangling_only: bool = True


class MaintenancePruneRequest(BaseModel):
    force: bool = False


class VolumeAttach(BaseModel):
    volume_name: str
    mount_point: str
    mode: str = "rw"


class VolumeDelete(BaseModel):
    force: bool = False
