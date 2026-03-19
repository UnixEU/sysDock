import asyncio
import contextlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import List
import io

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, PlainTextResponse
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from docker.errors import DockerException

from app.core.config import settings
from app.core.security import authenticate_connection, get_current_active_user, get_current_admin_user
from app.db.session import get_db
from app.models.user import User
from app.models.resource_metric import ResourceMetric
from app.services.docker_service import (
    docker_service,
    DockerServiceError,
    DockerNotFoundError,
    DockerValidationError,
)
from app.schemas.docker import (
    ContainerInfo,
    ContainerDetail,
    ContainerUpdate,
    ContainerRename,
    NetworkCreate,
    VolumeCreate,
    VolumeAttach,
    VolumeDelete,
    ImageExport,
    ImageTag,
    ImagePull,
    ImagePush,
    ImageDelete,
    ImagePrune,
    MaintenancePruneRequest,
    ComposeUpdate,
    ComposeCreate,
    ImageBuild,
    DockerSystemInfo,
    ResourceHistory,
    ResourceMetricPoint,
)
from app.db.redis_client import redis_client
from app.core.limiter import limiter

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/system", response_model=DockerSystemInfo)
async def get_system_info(
    realtime: bool = False,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Get Docker system information"""
    try:
        # For non-realtime requests, use a short-lived cache to avoid hammering Docker
        if not realtime:
            cached = await redis_client.get("docker:system_info")
            if cached:
                return cached

        info = docker_service.get_system_info()

        # Persist a snapshot for historical charts (retain last 30 days)
        try:
            metric = ResourceMetric(
                timestamp=datetime.now(timezone.utc),
                cpu_percent=info.get("total_cpu_percent", 0.0),
                memory_mb=(info.get("total_memory_bytes", 0) or 0) / (1024 * 1024),
            )
            db.add(metric)

            cutoff = datetime.now(timezone.utc) - timedelta(days=30)
            await db.execute(
                delete(ResourceMetric).where(ResourceMetric.timestamp < cutoff)
            )
            await db.commit()
        except Exception as e:
            logger.error("Failed to persist resource metric: %s", e, exc_info=True)
            await db.rollback()

        # Cache for 10 seconds for non-realtime consumers
        if not realtime:
            await redis_client.set("docker:system_info", info, expire=10)

        return info
    except DockerServiceError as e:
        logger.error("get_system_info failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/system/history", response_model=ResourceHistory)
async def get_system_history(
    window: str = "5m",
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Get historical resource usage for the given time window."""
    window_map = {
        "5m": timedelta(minutes=5),
        "15m": timedelta(minutes=15),
        "1h": timedelta(hours=1),
        "1d": timedelta(days=1),
        "1month": timedelta(days=30),
    }

    if window not in window_map:
        raise HTTPException(
            status_code=400,
            detail="Invalid window. Use one of: 5m, 15m, 1h, 1d, 1month.",
        )

    cutoff = datetime.now(timezone.utc) - window_map[window]

    result = await db.execute(
        select(ResourceMetric)
        .where(ResourceMetric.timestamp >= cutoff)
        .order_by(ResourceMetric.timestamp)
    )
    rows = result.scalars().all()

    points = [
        ResourceMetricPoint(
            timestamp=row.timestamp,
            cpu_percent=row.cpu_percent,
            memory_mb=row.memory_mb,
        )
        for row in rows
    ]

    return ResourceHistory(points=points)


@router.get("/containers", response_model=List[ContainerInfo])
async def list_containers(
    all: bool = True,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_active_user)
):
    """List Docker containers"""
    try:
        containers = docker_service.list_containers(all=all)
        return containers[skip:skip + limit]
    except DockerServiceError as e:
        logger.error("list_containers failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/containers/{container_id}", response_model=ContainerDetail)
async def get_container_details(
    container_id: str,
    current_user: User = Depends(get_current_active_user)
):
    """Get detailed information about a container"""
    try:
        details = docker_service.get_container_details(container_id)
        return details
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("get_container_details(%s) failed: %s", container_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/containers/{container_id}/start")
@limiter.limit("60/minute")
async def start_container(
    request: Request,
    container_id: str,
    current_user: User = Depends(get_current_admin_user)
):
    """Start a container"""
    try:
        result = docker_service.start_container(container_id)
        await redis_client.delete("docker:system_info")
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("start_container(%s) failed: %s", container_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/containers/{container_id}/stop")
@limiter.limit("60/minute")
async def stop_container(
    request: Request,
    container_id: str,
    current_user: User = Depends(get_current_admin_user)
):
    """Stop a container"""
    try:
        result = docker_service.stop_container(container_id)
        await redis_client.delete("docker:system_info")
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("stop_container(%s) failed: %s", container_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/containers/{container_id}/restart")
@limiter.limit("60/minute")
async def restart_container(
    request: Request,
    container_id: str,
    current_user: User = Depends(get_current_admin_user)
):
    """Restart a container"""
    try:
        result = docker_service.restart_container(container_id)
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("restart_container(%s) failed: %s", container_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get(
    "/containers/{container_id}/logs",
    response_class=PlainTextResponse,
)
async def get_container_logs(
    container_id: str,
    tail: int = Query(200, ge=1, le=5000),
    since: int | None = Query(
        None,
        description="Unix timestamp to start from (optional, ignored when from_top is true)",
    ),
    from_top: bool = Query(
        False,
        alias="fromTop",
        description="If true, return logs from container start time",
    ),
    current_user: User = Depends(get_current_active_user),
):
    """Return latest container logs as plain text (no live updates)."""
    try:
        logs_bytes = docker_service.get_container_logs(
            container_id=container_id,
            tail=tail,
            since=since,
            follow=False,
            from_top=from_top,
        )
        return logs_bytes.decode("utf-8", errors="replace")
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("get_container_logs(%s) failed: %s", container_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/containers/{container_id}/logs/stream")
async def stream_container_logs(
    container_id: str,
    tail: int = Query(50, ge=0, le=2000),
    current_user: User = Depends(get_current_active_user),
):
    """Stream container logs in near real-time (similar to `docker logs -f`)."""

    def log_iterator():
        try:
            stream = docker_service.get_container_logs(
                container_id=container_id,
                tail=tail,
                since=None,
                follow=True,
                from_top=False,
            )
            for chunk in stream:
                text = chunk.decode("utf-8", errors="replace")
                if not text.endswith("\n"):
                    text += "\n"
                yield text
        except DockerNotFoundError as e:
            yield f"[error] {e}\n"
        except DockerServiceError as e:
            yield f"[error] {e}\n"

    return StreamingResponse(
        log_iterator(),
        media_type="text/plain",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.websocket("/containers/{container_id}/exec/ws")
async def container_shell_session(
    websocket: WebSocket,
    container_id: str,
    shell: str = Query("sh"),
    cols: int = Query(120, ge=40, le=300),
    rows: int = Query(32, ge=10, le=120),
    db: AsyncSession = Depends(get_db),
):
    if not settings.ENABLE_CONTAINER_SHELL:
        await websocket.accept()
        await websocket.send_text("[error] Container shell access is disabled by configuration.\r\n")
        await websocket.close(code=4403)
        return

    try:
        current_user = await authenticate_connection(websocket, db)
    except HTTPException:
        await websocket.close(code=4401)
        return

    if not current_user.is_superuser:
        await websocket.accept()
        logger.warning(
            "container_shell_session denied for non-superuser user=%s container=%s ip=%s",
            current_user.username,
            container_id,
            getattr(websocket.client, "host", "unknown"),
        )
        await websocket.send_text("[error] Container shell access requires a superuser account.\r\n")
        await websocket.close(code=4403)
        return

    await websocket.accept()

    try:
        shell_session = docker_service.open_container_shell(container_id, shell)
        raw_socket = getattr(shell_session.socket, "_sock", shell_session.socket)
        safe_cols = min(max(cols, 40), settings.CONTAINER_SHELL_MAX_COLS)
        safe_rows = min(max(rows, 10), settings.CONTAINER_SHELL_MAX_ROWS)
        docker_service.resize_container_shell(shell_session.exec_id, safe_cols, safe_rows)
        logger.info(
            "container shell opened user=%s container=%s(%s) shell=%s ip=%s",
            current_user.username,
            shell_session.container_name,
            shell_session.container_id,
            shell_session.shell,
            getattr(websocket.client, "host", "unknown"),
        )
    except DockerNotFoundError as e:
        await websocket.send_text(f"[error] {e}\n")
        await websocket.close(code=4404)
        return
    except DockerValidationError as e:
        await websocket.send_text(f"[error] {e}\n")
        await websocket.close(code=4400)
        return
    except DockerServiceError as e:
        await websocket.send_text(f"[error] {e}\n")
        await websocket.close(code=1011)
        return

    async def forward_output():
        while True:
            chunk = await asyncio.to_thread(raw_socket.recv, 4096)
            if not chunk:
                break
            await websocket.send_text(chunk.decode("utf-8", errors="replace"))

    reader_task = asyncio.create_task(forward_output())

    try:
        while True:
            payload = await asyncio.wait_for(
                websocket.receive_text(),
                timeout=settings.CONTAINER_SHELL_IDLE_TIMEOUT_SECONDS,
            )

            try:
                message = json.loads(payload)
            except json.JSONDecodeError:
                message = {"type": "input", "data": payload}

            message_type = message.get("type")
            if message_type == "input":
                data = message.get("data", "")
                if data:
                    sender = getattr(raw_socket, "sendall", raw_socket.send)
                    await asyncio.to_thread(sender, data.encode("utf-8"))
            elif message_type == "resize":
                new_cols = int(message.get("cols", safe_cols))
                new_rows = int(message.get("rows", safe_rows))
                safe_cols = min(max(new_cols, 40), settings.CONTAINER_SHELL_MAX_COLS)
                safe_rows = min(max(new_rows, 10), settings.CONTAINER_SHELL_MAX_ROWS)
                docker_service.resize_container_shell(shell_session.exec_id, safe_cols, safe_rows)
            elif message_type == "disconnect":
                break
    except asyncio.TimeoutError:
        await websocket.send_text("\r\n[session timed out due to inactivity]\r\n")
        logger.info(
            "container shell timed out user=%s container=%s(%s)",
            current_user.username,
            shell_session.container_name,
            shell_session.container_id,
        )
    except WebSocketDisconnect:
        logger.info(
            "container shell disconnected user=%s container=%s(%s)",
            current_user.username,
            shell_session.container_name,
            shell_session.container_id,
        )
    except Exception as e:
        logger.error("container_shell_session(%s) failed: %s", container_id, e, exc_info=True)
    finally:
        with contextlib.suppress(Exception):
            shell_session.socket.close()
        reader_task.cancel()
        with contextlib.suppress(Exception, asyncio.CancelledError):
            await reader_task
        logger.info(
            "container shell closed user=%s container=%s(%s)",
            current_user.username,
            shell_session.container_name,
            shell_session.container_id,
        )


@router.delete("/containers/{container_id}")
@limiter.limit("30/minute")
async def remove_container(
    request: Request,
    container_id: str,
    force: bool = False,
    current_user: User = Depends(get_current_admin_user)
):
    """Remove a container"""
    try:
        result = docker_service.remove_container(container_id, force=force)
        await redis_client.delete("docker:system_info")
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("remove_container(%s) failed: %s", container_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/containers/{container_id}")
@limiter.limit("30/minute")
async def update_container(
    request: Request,
    container_id: str,
    updates: ContainerUpdate,
    current_user: User = Depends(get_current_admin_user)
):
    """Update container configuration"""
    try:
        result = docker_service.update_container(
            container_id,
            updates.model_dump(exclude_none=True)
        )
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("update_container(%s) failed: %s", container_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/containers/{container_id}/compose")
async def get_compose_file(
    container_id: str,
    current_user: User = Depends(get_current_active_user)
):
    """Get docker-compose.yml content for a container"""
    try:
        content = docker_service.get_compose_file(container_id)
        if content is None:
            raise HTTPException(
                status_code=404,
                detail="Container was not started with docker-compose"
            )
        return {"compose_content": content}
    except HTTPException:
        raise
    except DockerServiceError as e:
        logger.error("get_compose_file(%s) failed: %s", container_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.put("/containers/{container_id}/compose")
@limiter.limit("20/minute")
async def update_compose_file(
    request: Request,
    container_id: str,
    compose_data: ComposeUpdate,
    current_user: User = Depends(get_current_admin_user)
):
    """Update docker-compose.yml and recreate container"""
    try:
        result = docker_service.update_compose_file(container_id, compose_data.compose_content)
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DockerServiceError as e:
        logger.error("update_compose_file(%s) failed: %s", container_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/containers/{container_id}/networks/{network_name}")
async def connect_to_network(
    container_id: str,
    network_name: str,
    current_user: User = Depends(get_current_admin_user)
):
    """Connect container to a network"""
    try:
        result = docker_service.connect_container_to_network(container_id, network_name)
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("connect_to_network(%s, %s) failed: %s", container_id, network_name, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/containers/{container_id}/networks/{network_name}")
async def disconnect_from_network(
    container_id: str,
    network_name: str,
    current_user: User = Depends(get_current_admin_user)
):
    """Disconnect container from a network"""
    try:
        result = docker_service.disconnect_container_from_network(container_id, network_name)
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("disconnect_from_network(%s, %s) failed: %s", container_id, network_name, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/networks")
async def list_networks(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_active_user)
):
    """List all Docker networks"""
    try:
        networks = docker_service.list_networks()
        return networks[skip:skip + limit]
    except DockerServiceError as e:
        logger.error("list_networks failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/networks/{network_id}")
async def get_network_details(
    network_id: str,
    current_user: User = Depends(get_current_active_user),
):
    """Get detailed information about a Docker network, including connected containers."""
    try:
        network = docker_service.client.networks.get(network_id)
        attrs = network.attrs

        containers = []
        for container_id, info in attrs.get("Containers", {}).items():
            try:
                container = docker_service.client.containers.get(container_id)
                containers.append(
                    {
                        "id": container.short_id,
                        "name": container.name,
                        "image": container.image.tags[0]
                        if container.image.tags
                        else container.image.short_id,
                        "endpoint_id": info.get("EndpointID"),
                        "mac_address": info.get("MacAddress"),
                        "ipv4_address": info.get("IPv4Address"),
                        "ipv6_address": info.get("IPv6Address"),
                    }
                )
            except Exception:
                # Skip containers that cannot be inspected
                continue

        ipam = attrs.get("IPAM", {}) or {}
        ipam_configs = ipam.get("Config") or []
        primary_ipam = ipam_configs[0] if ipam_configs else {}

        return {
            "id": network.id,
            "name": network.name,
            "driver": attrs.get("Driver"),
            "scope": attrs.get("Scope"),
            "subnet": primary_ipam.get("Subnet"),
            "gateway": primary_ipam.get("Gateway"),
            "ip_range": primary_ipam.get("IPRange"),
            "containers": containers,
        }
    except DockerException as e:
        logger.error("get_network_details(%s) failed: %s", network_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/networks")
@limiter.limit("30/minute")
async def create_network(
    request: Request,
    network_data: NetworkCreate,
    current_user: User = Depends(get_current_admin_user)
):
    """Create a new Docker network"""
    try:
        result = docker_service.create_network(
            name=network_data.name,
            driver=network_data.driver,
            options=network_data.options
        )
        await redis_client.delete("docker:system_info")
        return result
    except DockerServiceError as e:
        logger.error("create_network failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/volumes")
async def list_volumes(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_active_user)
):
    """List all Docker volumes"""
    try:
        volumes = docker_service.list_volumes()
        return volumes[skip:skip + limit]
    except DockerServiceError as e:
        logger.error("list_volumes failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/volumes/{volume_name}")
async def get_volume_details(
    volume_name: str,
    current_user: User = Depends(get_current_active_user),
):
    """Get detailed information about a Docker volume."""
    try:
        return docker_service.get_volume_details(volume_name)
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("get_volume_details(%s) failed: %s", volume_name, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/volumes")
@limiter.limit("30/minute")
async def create_volume(
    request: Request,
    volume_data: VolumeCreate,
    current_user: User = Depends(get_current_admin_user)
):
    """Create a new Docker volume"""
    try:
        result = docker_service.create_volume(
            name=volume_data.name,
            driver=volume_data.driver,
            options=volume_data.options,
            host_path=volume_data.host_path
        )
        await redis_client.delete("docker:system_info")
        return result
    except DockerServiceError as e:
        logger.error("create_volume failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/images")
async def list_images(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    current_user: User = Depends(get_current_active_user)
):
    """List all Docker images"""
    try:
        images = docker_service.list_images()
        return images[skip:skip + limit]
    except DockerServiceError as e:
        logger.error("list_images failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/images/export")
@limiter.limit("10/minute")
async def export_image(
    request: Request,
    image_data: ImageExport,
    current_user: User = Depends(get_current_admin_user)
):
    """Export a Docker image"""
    try:
        image_bytes = docker_service.export_image(image_data.image_name, image_data.tag)

        # Convert generator to bytes
        data = b""
        for chunk in image_bytes:
            data += chunk

        filename = f"{image_data.image_name.replace('/', '_')}_{image_data.tag}.tar"

        return StreamingResponse(
            io.BytesIO(data),
            media_type="application/x-tar",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("export_image failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/images/{image_id}/export")
@limiter.limit("10/minute")
async def export_image_by_id(
    request: Request,
    image_id: str,
    current_user: User = Depends(get_current_admin_user),
):
    """Export a Docker image identified by its ID or short ID."""
    try:
        image_bytes = docker_service.export_image(image_id)

        data = b""
        for chunk in image_bytes:
            data += chunk

        # Try to derive a friendly filename from image tags
        filename = image_id.replace("/", "_")
        try:
            image = docker_service.client.images.get(image_id)
            if image.tags:
                filename = image.tags[0].replace("/", "_").replace(":", "_")
        except Exception:
            pass

        filename = f"{filename}.tar"

        return StreamingResponse(
            io.BytesIO(data),
            media_type="application/x-tar",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("export_image_by_id(%s) failed: %s", image_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/images/import")
@limiter.limit("10/minute")
async def import_image(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_admin_user)
):
    """Import a Docker image"""
    try:
        image_data = await file.read()
        result = docker_service.import_image(image_data)
        await redis_client.delete("docker:system_info")
        return result
    except DockerServiceError as e:
        logger.error("import_image failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/containers/{container_id}/rename")
async def rename_container(
    container_id: str,
    rename_data: ContainerRename,
    current_user: User = Depends(get_current_admin_user)
):
    """Rename a container"""
    try:
        result = docker_service.rename_container(container_id, rename_data.new_name)
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("rename_container(%s) failed: %s", container_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/containers/{container_id}/volumes")
@limiter.limit("30/minute")
async def attach_volume(
    request: Request,
    container_id: str,
    volume_data: VolumeAttach,
    current_user: User = Depends(get_current_admin_user)
):
    """Attach a volume to a container"""
    try:
        result = docker_service.attach_volume_to_container(
            container_id,
            volume_data.volume_name,
            volume_data.mount_point,
            volume_data.mode
        )
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DockerServiceError as e:
        logger.error("attach_volume(%s) failed: %s", container_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/images/{image_id}/tag")
async def tag_image(
    image_id: str,
    tag_data: ImageTag,
    current_user: User = Depends(get_current_admin_user)
):
    """Tag a Docker image"""
    try:
        result = docker_service.tag_image(image_id, tag_data.repository, tag_data.tag)
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("tag_image(%s) failed: %s", image_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/images/pull")
@limiter.limit("10/minute")
async def pull_image(
    request: Request,
    pull_data: ImagePull,
    current_user: User = Depends(get_current_admin_user)
):
    """Pull a Docker image"""
    try:
        result = docker_service.pull_image(pull_data.repository, pull_data.tag)
        await redis_client.delete("docker:system_info")
        return result
    except DockerServiceError as e:
        logger.error("pull_image failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/images/push")
@limiter.limit("10/minute")
async def push_image(
    request: Request,
    push_data: ImagePush,
    current_user: User = Depends(get_current_admin_user)
):
    """Push a Docker image"""
    try:
        result = docker_service.push_image(push_data.repository, push_data.tag)
        return result
    except DockerServiceError as e:
        logger.error("push_image failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/images/{image_id}")
@limiter.limit("30/minute")
async def delete_image(
    request: Request,
    image_id: str,
    force: bool = False,
    current_user: User = Depends(get_current_admin_user)
):
    """Delete a Docker image"""
    try:
        result = docker_service.delete_image(image_id, force=force)
        await redis_client.delete("docker:system_info")
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("delete_image(%s) failed: %s", image_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/images/prune")
@limiter.limit("5/minute")
async def prune_images(
    request: Request,
    prune_data: ImagePrune,
    current_user: User = Depends(get_current_admin_user)
):
    """Prune unused Docker images"""
    try:
        result = docker_service.prune_images(prune_data.dangling_only)
        await redis_client.delete("docker:system_info")
        return result
    except DockerServiceError as e:
        logger.error("prune_images failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/maintenance/prune/volumes")
@limiter.limit("5/minute")
async def prune_volumes(
    request: Request,
    prune_data: MaintenancePruneRequest,
    current_user: User = Depends(get_current_admin_user)
):
    """Prune unused Docker volumes."""
    try:
        result = docker_service.prune_volumes(prune_data.force)
        await redis_client.delete("docker:system_info")
        return result
    except DockerServiceError as e:
        logger.error("prune_volumes failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/maintenance/prune/builder")
@limiter.limit("5/minute")
async def prune_builder_cache(
    request: Request,
    prune_data: MaintenancePruneRequest,
    current_user: User = Depends(get_current_admin_user)
):
    """Prune Docker builder cache."""
    try:
        result = docker_service.prune_builder_cache(prune_data.force)
        await redis_client.delete("docker:system_info")
        return result
    except DockerServiceError as e:
        logger.error("prune_builder_cache failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/maintenance/prune/system")
@limiter.limit("5/minute")
async def prune_system(
    request: Request,
    prune_data: MaintenancePruneRequest,
    current_user: User = Depends(get_current_admin_user)
):
    """Prune Docker system resources."""
    try:
        result = docker_service.prune_system(prune_data.force)
        await redis_client.delete("docker:system_info")
        return result
    except DockerServiceError as e:
        logger.error("prune_system failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/networks/{network_id}")
@limiter.limit("30/minute")
async def delete_network(
    request: Request,
    network_id: str,
    current_user: User = Depends(get_current_admin_user)
):
    """Delete a Docker network"""
    try:
        result = docker_service.delete_network(network_id)
        await redis_client.delete("docker:system_info")
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DockerServiceError as e:
        logger.error("delete_network(%s) failed: %s", network_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/volumes/{volume_name}")
@limiter.limit("30/minute")
async def delete_volume(
    request: Request,
    volume_name: str,
    force: bool = False,
    current_user: User = Depends(get_current_admin_user)
):
    """Delete a Docker volume"""
    try:
        result = docker_service.delete_volume(volume_name, force=force)
        await redis_client.delete("docker:system_info")
        return result
    except DockerNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except DockerServiceError as e:
        logger.error("delete_volume(%s) failed: %s", volume_name, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/compose/up")
@limiter.limit("10/minute")
async def create_from_compose(
    request: Request,
    compose_data: ComposeCreate,
    current_user: User = Depends(get_current_admin_user)
):
    """Create containers from docker-compose content"""
    try:
        result = docker_service.create_from_compose(compose_data.compose_content)
        await redis_client.delete("docker:system_info")
        return result
    except DockerValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DockerServiceError as e:
        logger.error("create_from_compose failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/images/build")
@limiter.limit("5/minute")
async def build_image(
    request: Request,
    build_data: ImageBuild,
    current_user: User = Depends(get_current_admin_user)
):
    """Build a Docker image from Dockerfile content"""
    try:
        result = docker_service.build_image(
            build_data.dockerfile_content,
            build_data.tag
        )
        await redis_client.delete("docker:system_info")
        return result
    except DockerServiceError as e:
        logger.error("build_image failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
