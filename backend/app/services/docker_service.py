import logging
import docker
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
from docker.models.containers import Container
from docker.errors import DockerException, NotFound, APIError
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
import yaml
import os
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


class DockerServiceError(Exception):
    """Base exception for Docker service errors."""


class DockerNotFoundError(DockerServiceError):
    """Raised when a requested Docker resource cannot be found."""


class DockerValidationError(DockerServiceError):
    """Raised when user-provided input (e.g. compose YAML) is invalid."""


@dataclass
class ContainerShellSession:
    exec_id: str
    socket: Any
    container_id: str
    container_name: str
    shell: str


class DockerService:
    def __init__(self):
        try:
            # Use from_env() which automatically configures the client
            self.client = docker.from_env()
            self.client.ping()
        except DockerException as e:
            raise Exception(f"Failed to connect to Docker: {str(e)}")

    def _fetch_container_stats(self, container: Container):
        """Fetch stats for a single running container. Intended for thread pool use."""
        try:
            return container, container.stats(stream=False)
        except Exception:
            logger.warning("Failed to get stats for container %s", container.id, exc_info=True)
            return container, None

    def get_system_info(self) -> Dict[str, Any]:
        """Get Docker system information with enhanced stats"""
        info = self.client.info()
        version = self.client.version()

        containers = self.client.containers.list(all=True)

        # Count containers by status
        status_counts = {"running": 0, "exited": 0, "stopped": 0, "created": 0, "paused": 0, "other": 0}
        total_cpu = 0.0
        total_memory = 0

        running_containers = [c for c in containers if c.status.lower() == "running"]
        for c in containers:
            s = c.status.lower()
            if s == "running":
                status_counts["running"] += 1
            elif s in status_counts:
                status_counts[s] += 1
            else:
                status_counts["other"] += 1

        # Fetch stats for all running containers in parallel
        if running_containers:
            workers = min(10, len(running_containers))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                results = list(pool.map(self._fetch_container_stats, running_containers))

            for _container, stats in results:
                if not stats:
                    continue
                try:
                    cpu_delta = (
                        stats['cpu_stats']['cpu_usage']['total_usage']
                        - stats['precpu_stats']['cpu_usage']['total_usage']
                    )
                    system_delta = (
                        stats['cpu_stats']['system_cpu_usage']
                        - stats['precpu_stats']['system_cpu_usage']
                    )
                    if system_delta > 0:
                        cpu_percent = (
                            (cpu_delta / system_delta)
                            * len(stats['cpu_stats']['cpu_usage'].get('percpu_usage', [1]))
                            * 100.0
                        )
                        total_cpu += cpu_percent

                    total_memory += stats['memory_stats'].get('usage', 0)
                except (KeyError, TypeError):
                    logger.warning("Unexpected stats structure for a container", exc_info=True)

        # Get docker system df info
        df_info = self.get_system_df()

        return {
            "containers_running": status_counts["running"],
            "containers_stopped": status_counts["stopped"],
            "containers_exited": status_counts["exited"],
            "containers_created": status_counts["created"],
            "containers_paused": status_counts["paused"],
            "containers_total": len(containers),
            "images_count": len(self.client.images.list()),
            "volumes_count": len(self.client.volumes.list()),
            "networks_count": len(self.client.networks.list()),
            "docker_version": version.get("Version", "Unknown"),
            "server_version": info.get("ServerVersion", "Unknown"),
            "total_cpu_percent": round(total_cpu, 2),
            "total_memory_bytes": total_memory,
            "total_memory_mb": round(total_memory / (1024 * 1024), 2),
            "host_memory_bytes": info.get("MemTotal", 0),
            "host_memory_mb": round((info.get("MemTotal", 0) or 0) / (1024 * 1024), 2),
            "system_df": df_info
        }

    def _detect_container_type(self, container: Container) -> str:
        """Detect if container was started with docker run or docker compose"""
        labels = container.labels
        if "com.docker.compose.project" in labels:
            return "compose"
        return "run"

    @staticmethod
    def _is_relative_bind_source(source: str) -> bool:
        return source.startswith(".") or ("/" in source and not os.path.isabs(source))

    def _validate_compose_payload(self, compose_content: str) -> Dict[str, Any]:
        try:
            parsed = yaml.safe_load(compose_content)
        except yaml.YAMLError as e:
            raise DockerValidationError(f"Invalid docker-compose YAML: {e}") from e

        if not isinstance(parsed, dict):
            raise DockerValidationError("Compose file must be a YAML mapping.")

        services = parsed.get("services")
        if not isinstance(services, dict) or not services:
            raise DockerValidationError("Compose file must define at least one service.")

        for service_name, service_config in services.items():
            if not isinstance(service_config, dict):
                raise DockerValidationError(f"Service '{service_name}' configuration must be a mapping.")

            if "build" in service_config:
                raise DockerValidationError(
                    "Compose build contexts are not supported from the web UI yet. "
                    "Use pre-built images instead."
                )

            for volume in service_config.get("volumes", []):
                if isinstance(volume, str):
                    source = volume.split(":", 1)[0]
                    if source and self._is_relative_bind_source(source):
                        raise DockerValidationError(
                            "Relative bind mounts are not supported from the web UI. "
                            "Use named volumes or absolute host paths."
                        )
                elif isinstance(volume, dict) and volume.get("type") == "bind":
                    source = volume.get("source") or volume.get("src") or ""
                    if source and self._is_relative_bind_source(source):
                        raise DockerValidationError(
                            "Relative bind mounts are not supported from the web UI. "
                            "Use named volumes or absolute host paths."
                        )

        return parsed

    @staticmethod
    def _format_prune_output(command: str, lines: List[str]) -> str:
        visible_lines = [line for line in lines if line]
        if not visible_lines:
            visible_lines = ["No changes were reported by Docker."]
        return "\n".join([f"$ {command}", *visible_lines])

    def list_containers(self, all: bool = True) -> List[Dict[str, Any]]:
        """List all containers"""
        containers = self.client.containers.list(all=all)
        result = []

        for container in containers:
            try:
                attrs = container.attrs if isinstance(container.attrs, dict) else {}
                state = attrs.get("State", {}).get("Status") or container.status
                created = attrs.get("Created") or attrs.get("CreatedAt") or ""
                image = container.image.tags[0] if container.image.tags else container.image.short_id

                result.append({
                    "id": container.short_id,
                    "name": container.name,
                    "image": image,
                    "status": container.status,
                    "state": state,
                    "created": created,
                    "started_with": self._detect_container_type(container),
                })
            except Exception:
                logger.warning(
                    "Skipping container %s because its metadata could not be normalized",
                    getattr(container, "id", "<unknown>"),
                    exc_info=True,
                )

        return result

    def get_container_details(self, container_id: str) -> Dict[str, Any]:
        """Get detailed information about a container"""
        try:
            container = self.client.containers.get(container_id)
            attrs = container.attrs
            config = attrs['Config']
            network_settings = attrs['NetworkSettings']

            # Parse volumes
            volumes = []
            mounts = attrs.get('Mounts', [])
            for mount in mounts:
                volumes.append({
                    "source": mount.get('Source', ''),
                    "destination": mount.get('Destination', ''),
                    "mode": mount.get('Mode', ''),
                    "type": mount.get('Type', '')
                })

            # Parse networks
            networks = list(network_settings['Networks'].keys())

            # Parse ports
            ports = network_settings.get('Ports', {})

            return {
                "id": container.short_id,
                "name": container.name,
                "image": container.image.tags[0] if container.image.tags else container.image.short_id,
                "status": container.status,
                "state": attrs['State']['Status'],
                "created": attrs['Created'],
                "ports": ports,
                "volumes": volumes,
                "networks": networks,
                "environment": config.get('Env', []),
                "labels": config.get('Labels', {}),
                "started_with": self._detect_container_type(container)
            }
        except NotFound:
            raise DockerNotFoundError(f"Container {container_id} not found")
        except APIError as e:
            raise DockerServiceError(f"Docker API error: {str(e)}")

    def start_container(self, container_id: str) -> Dict[str, str]:
        """Start a container"""
        try:
            container = self.client.containers.get(container_id)
            container.start()
            return {"status": "success", "message": f"Container {container_id} started"}
        except NotFound:
            raise DockerNotFoundError(f"Container {container_id} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to start container: {str(e)}")

    def stop_container(self, container_id: str) -> Dict[str, str]:
        """Stop a container"""
        try:
            container = self.client.containers.get(container_id)
            container.stop()
            return {"status": "success", "message": f"Container {container_id} stopped"}
        except NotFound:
            raise DockerNotFoundError(f"Container {container_id} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to stop container: {str(e)}")

    def restart_container(self, container_id: str) -> Dict[str, str]:
        """Restart a container"""
        try:
            container = self.client.containers.get(container_id)
            container.restart()
            return {"status": "success", "message": f"Container {container_id} restarted"}
        except NotFound:
            raise DockerNotFoundError(f"Container {container_id} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to restart container: {str(e)}")

    def get_container_logs(
        self,
        container_id: str,
        tail: int = 200,
        since: Optional[int] = None,
        follow: bool = False,
        from_top: bool = False,
    ):
        """
        Get logs for a container.

        - If follow is False, returns a bytes object with the latest logs.
        - If follow is True, returns an iterator yielding log chunks (bytes).
        """
        try:
            container = self.client.containers.get(container_id)

            effective_since = since
            effective_tail: int | str = tail

            if from_top:
                # Derive since from container start time so we get logs from the beginning
                started_at = container.attrs.get("State", {}).get("StartedAt")
                if started_at:
                    ts = started_at.rstrip("Z")
                    if "." in ts:
                        date_part, frac = ts.split(".", 1)
                        frac = frac[:6]
                        ts = f"{date_part}.{frac}"
                    ts = ts + "+00:00"
                    try:
                        dt = datetime.fromisoformat(ts)
                        effective_since = int(dt.replace(tzinfo=timezone.utc).timestamp())
                    except Exception:
                        effective_since = 0
                else:
                    effective_since = 0
                effective_tail = "all"

            logs = container.logs(
                stream=follow,
                tail=effective_tail,
                since=effective_since,
                follow=follow,
            )
            return logs
        except NotFound:
            raise DockerNotFoundError(f"Container {container_id} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to fetch logs: {str(e)}")

    def open_container_shell(self, container_id: str, shell: str):
        """Open an interactive Docker exec socket for a running container."""
        if shell not in {"sh", "bash"}:
            raise DockerValidationError("Unsupported shell. Use 'sh' or 'bash'.")

        try:
            container = self.client.containers.get(container_id)
            if container.status.lower() != "running":
                raise DockerValidationError("Container must be running to open a shell.")

            shell_command = ["/bin/bash", "-i"] if shell == "bash" else ["/bin/sh", "-i"]
            exec_id = self.client.api.exec_create(
                container=container.id,
                cmd=shell_command,
                tty=True,
                stdin=True,
                stdout=True,
                stderr=True,
                environment={
                    "TERM": "xterm-256color",
                },
            )
            shell_socket = self.client.api.exec_start(
                exec_id=exec_id["Id"],
                tty=True,
                socket=True,
                stream=False,
            )
            return ContainerShellSession(
                exec_id=exec_id["Id"],
                socket=shell_socket,
                container_id=container.short_id,
                container_name=container.name,
                shell=shell,
            )
        except NotFound:
            raise DockerNotFoundError(f"Container {container_id} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to open container shell: {str(e)}")

    def resize_container_shell(self, exec_id: str, cols: int, rows: int) -> None:
        """Resize an active exec TTY session."""
        try:
            self.client.api.exec_resize(exec_id, height=rows, width=cols)
        except APIError as e:
            raise DockerServiceError(f"Failed to resize container shell: {str(e)}")

    def remove_container(self, container_id: str, force: bool = False) -> Dict[str, str]:
        """Remove a container"""
        try:
            container = self.client.containers.get(container_id)
            container.remove(force=force)
            return {"status": "success", "message": f"Container {container_id} removed"}
        except NotFound:
            raise DockerNotFoundError(f"Container {container_id} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to remove container: {str(e)}")

    def update_container(self, container_id: str, updates: Dict[str, Any]) -> Dict[str, str]:
        """Update container configuration by recreating it"""
        try:
            old_container = self.client.containers.get(container_id)
            attrs = old_container.attrs
            config = attrs['Config']
            host_config = attrs['HostConfig']

            # Get current configuration
            image = updates.get('image', config['Image'])
            environment = updates.get('environment', config.get('Env', []))

            # Handle volumes
            volumes = {}
            binds = []
            if 'volumes' in updates:
                for vol in updates['volumes']:
                    if ':' in vol:
                        source, dest = vol.split(':')[:2]
                        volumes[dest] = {}
                        binds.append(vol)
            else:
                mounts = attrs.get('Mounts', [])
                for mount in mounts:
                    if mount['Type'] == 'bind':
                        bind_str = f"{mount['Source']}:{mount['Destination']}"
                        if 'Mode' in mount:
                            bind_str += f":{mount['Mode']}"
                        binds.append(bind_str)
                        volumes[mount['Destination']] = {}

            # Handle networks
            networks = updates.get('networks', list(attrs['NetworkSettings']['Networks'].keys()))

            # Handle ports
            ports = updates.get('ports', host_config.get('PortBindings', {}))

            # Stop and remove old container
            old_container.stop()
            old_container.remove()

            # Create new container
            new_container = self.client.containers.run(
                image=image,
                name=old_container.name,
                environment=environment,
                volumes=volumes if volumes else None,
                ports=ports if ports else None,
                detach=True,
                network=networks[0] if networks else None
            )

            # Connect to additional networks
            for network in networks[1:]:
                try:
                    net = self.client.networks.get(network)
                    net.connect(new_container)
                except Exception:
                    logger.warning("Failed to connect new container to network %s", network, exc_info=True)

            return {"status": "success", "message": f"Container {container_id} updated and recreated"}
        except NotFound:
            raise DockerNotFoundError(f"Container {container_id} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to update container: {str(e)}")

    def get_compose_file(self, container_id: str) -> Optional[str]:
        """Get docker-compose.yml content for a container started with compose"""
        try:
            container = self.client.containers.get(container_id)
            labels = container.labels

            if "com.docker.compose.project" not in labels:
                return None

            project_dir = labels.get("com.docker.compose.project.working_dir", "")

            if project_dir:
                compose_file = Path(project_dir) / "docker-compose.yml"
                if compose_file.exists():
                    return compose_file.read_text()

            return None
        except Exception:
            logger.warning("Failed to get compose file for container %s", container_id, exc_info=True)
            return None

    def update_compose_file(self, container_id: str, compose_content: str) -> Dict[str, str]:
        """Update docker-compose.yml and recreate container"""
        try:
            container = self.client.containers.get(container_id)
            labels = container.labels

            if "com.docker.compose.project" not in labels:
                raise DockerValidationError("Container was not started with docker-compose")

            project_dir = labels.get("com.docker.compose.project.working_dir", "")
            if not project_dir:
                raise DockerValidationError("Cannot determine compose project directory")

            self._validate_compose_payload(compose_content)

            compose_file = Path(project_dir) / "docker-compose.yml"
            if not compose_file.exists():
                raise DockerValidationError(
                    "Compose file is not accessible from the backend container. "
                    "This stack cannot be edited from the web UI in the current deployment."
                )

            # Create a simple backup before overwriting
            if compose_file.exists():
                backup_path = compose_file.with_suffix(compose_file.suffix + ".bak")
                backup_path.write_text(compose_file.read_text())

            compose_file.write_text(compose_content)

            # Use docker-compose to recreate
            import subprocess
            result = subprocess.run(
                ["docker-compose", "up", "-d", "--force-recreate"],
                cwd=project_dir,
                capture_output=True,
                text=True
            )

            if result.returncode != 0:
                raise DockerServiceError(f"Failed to recreate container: {result.stderr}")

            return {"status": "success", "message": "Container recreated with new compose configuration"}
        except NotFound:
            raise DockerNotFoundError(f"Container {container_id} not found")
        except DockerServiceError:
            # Re-raise structured service errors unchanged
            raise
        except Exception as e:
            raise DockerServiceError(f"Failed to update compose: {str(e)}") from e

    def create_network(self, name: str, driver: str = "bridge", options: Optional[Dict] = None) -> Dict[str, str]:
        """Create a Docker network"""
        try:
            network = self.client.networks.create(
                name=name,
                driver=driver,
                options=options or {}
            )
            return {"status": "success", "message": f"Network {name} created", "id": network.short_id}
        except APIError as e:
            raise DockerServiceError(f"Failed to create network: {str(e)}")

    def create_volume(self, name: str, driver: str = "local", options: Optional[Dict] = None, host_path: Optional[str] = None) -> Dict[str, str]:
        """Create a Docker volume or bind mount configuration"""
        try:
            if host_path:
                driver_opts = options or {}
                driver_opts["type"] = "none"
                driver_opts["o"] = "bind"
                driver_opts["device"] = host_path

                volume = self.client.volumes.create(
                    name=name,
                    driver=driver,
                    driver_opts=driver_opts
                )
            else:
                volume = self.client.volumes.create(
                    name=name,
                    driver=driver,
                    driver_opts=options or {}
                )
            return {"status": "success", "message": f"Volume {name} created", "name": volume.name}
        except APIError as e:
            raise DockerServiceError(f"Failed to create volume: {str(e)}")

    def list_networks(self) -> List[Dict[str, Any]]:
        """List all Docker networks"""
        networks = self.client.networks.list()
        return [
            {
                "id": net.short_id,
                "name": net.name,
                "driver": net.attrs.get('Driver', 'unknown'),
                "scope": net.attrs.get('Scope', 'unknown')
            }
            for net in networks
        ]

    def list_volumes(self) -> List[Dict[str, Any]]:
        """List all Docker volumes"""
        volumes = self.client.volumes.list()
        result = []
        for vol in volumes:
            driver_opts = vol.attrs.get('Options', {})
            host_path = driver_opts.get('device', '') if driver_opts else ''
            is_bind = driver_opts.get('type') == 'none' and driver_opts.get('o') == 'bind' if driver_opts else False

            result.append({
                "name": vol.name,
                "driver": vol.attrs.get('Driver', 'unknown'),
                "mountpoint": vol.attrs.get('Mountpoint', ''),
                "host_path": host_path,
                "is_bind_mount": is_bind
            })
        return result

    def _get_volume_usage_bytes(self, volume_name: str) -> Optional[int]:
        """Return usage size in bytes for a specific volume, if available."""
        try:
            df = self.client.df()
            for v in df.get("Volumes", []):
                if v.get("Name") == volume_name:
                    return v.get("UsageData", {}).get("Size", 0)
        except Exception:
            logger.warning("Failed to get volume usage for %s", volume_name, exc_info=True)
            return None
        return None

    @staticmethod
    def _format_bytes(size: Optional[int]) -> Optional[str]:
        if size is None:
            return None
        if size == 0:
            return "0 B"
        k = 1024.0
        units = ["B", "KB", "MB", "GB", "TB"]
        i = 0
        s = float(size)
        while s >= k and i < len(units) - 1:
            s /= k
            i += 1
        return f"{s:.2f} {units[i]}"

    def _scan_bind_mount_usage(self, host_path: str, max_children: int = 20) -> Dict[str, Any]:
        """
        Approximate du -h --max-depth=1 style usage for a bind mount path.
        """
        from os import walk, scandir

        if not os.path.exists(host_path):
            return {"accessible": False}

        def dir_size(path: str) -> int:
            total = 0
            for root, _dirs, files in walk(path):
                for f in files:
                    fp = os.path.join(root, f)
                    try:
                        total += os.path.getsize(fp)
                    except OSError:
                        continue
            return total

        total = dir_size(host_path)
        entries: List[Dict[str, Any]] = []
        try:
            with scandir(host_path) as it:
                for entry in it:
                    if len(entries) >= max_children:
                        break
                    try:
                        if entry.is_file(follow_symlinks=False):
                            size = os.path.getsize(entry.path)
                        elif entry.is_dir(follow_symlinks=False):
                            size = dir_size(entry.path)
                        else:
                            continue
                    except OSError:
                        continue
                    entries.append(
                        {
                            "name": entry.name,
                            "path": entry.path,
                            "size_bytes": size,
                            "size_human": self._format_bytes(size),
                        }
                    )
        except OSError:
            pass

        return {
            "accessible": True,
            "total_bytes": total,
            "total_human": self._format_bytes(total),
            "entries": entries,
        }

    def get_volume_details(self, volume_name: str) -> Dict[str, Any]:
        """Get detailed information about a Docker volume, including containers and usage."""
        try:
            volume = self.client.volumes.get(volume_name)
            attrs = volume.attrs

            driver_opts = attrs.get("Options", {}) or {}
            host_path = driver_opts.get("device", "") if driver_opts else ""
            is_bind = (
                driver_opts.get("type") == "none"
                and driver_opts.get("o") == "bind"
                if driver_opts
                else False
            )

            created_at = attrs.get("CreatedAt") or attrs.get("Created")
            mountpoint = attrs.get("Mountpoint", "")

            # Find containers using this volume
            containers: List[Dict[str, Any]] = []
            for container in self.client.containers.list(all=True):
                mounts = container.attrs.get("Mounts", [])
                for m in mounts:
                    m_type = m.get("Type")
                    if m_type == "volume" and m.get("Name") == volume.name:
                        containers.append(
                            {
                                "id": container.short_id,
                                "name": container.name,
                                "image": container.image.tags[0]
                                if container.image.tags
                                else container.image.short_id,
                                "destination": m.get("Destination"),
                            }
                        )
                        break
                    if (
                        is_bind
                        and host_path
                        and m_type == "bind"
                        and m.get("Source") == host_path
                    ):
                        containers.append(
                            {
                                "id": container.short_id,
                                "name": container.name,
                                "image": container.image.tags[0]
                                if container.image.tags
                                else container.image.short_id,
                                "destination": m.get("Destination"),
                            }
                        )
                        break

            size_bytes = self._get_volume_usage_bytes(volume.name)
            size_human = self._format_bytes(size_bytes)

            bind_usage = None
            if is_bind and host_path:
                bind_usage = self._scan_bind_mount_usage(host_path)

            return {
                "name": volume.name,
                "driver": attrs.get("Driver", "unknown"),
                "mountpoint": mountpoint,
                "host_path": host_path,
                "is_bind_mount": is_bind,
                "created_at": created_at,
                "size_bytes": size_bytes,
                "size_human": size_human,
                "containers": containers,
                "bind_usage": bind_usage,
            }
        except NotFound:
            raise DockerNotFoundError(f"Volume {volume_name} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to get volume details: {str(e)}")
        except Exception as e:
            raise DockerServiceError(f"Failed to get volume details: {str(e)}")

    def list_images(self) -> List[Dict[str, Any]]:
        """List all Docker images"""
        images = self.client.images.list()
        result = []
        for img in images:
            result.append({
                "id": img.short_id,
                "tags": img.tags,
                "size": img.attrs.get('Size', 0),
                "created": img.attrs.get('Created', '')
            })
        return result

    def export_image(self, image_ref: str, tag: Optional[str] = None) -> bytes:
        """Export a Docker image as tar."""
        try:
            full_ref = f"{image_ref}:{tag}" if tag else image_ref
            image = self.client.images.get(full_ref)
            return image.save()
        except NotFound:
            ref_display = f"{image_ref}:{tag}" if tag else image_ref
            raise DockerNotFoundError(f"Image {ref_display} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to export image: {str(e)}")

    def import_image(self, image_data: bytes) -> Dict[str, str]:
        """Import a Docker image from tar bytes."""
        try:
            images = self.client.images.load(image_data)

            if images:
                tags = images[0].tags if images[0].tags else ["unknown"]
                return {"status": "success", "message": f"Image imported: {tags[0]}"}

            return {"status": "success", "message": "Image imported"}
        except APIError as e:
            raise DockerServiceError(f"Failed to import image: {str(e)}")

    def connect_container_to_network(self, container_id: str, network_name: str) -> Dict[str, str]:
        """Connect a container to a network"""
        try:
            container = self.client.containers.get(container_id)
            network = self.client.networks.get(network_name)
            network.connect(container)
            return {"status": "success", "message": f"Container connected to network {network_name}"}
        except NotFound as e:
            raise DockerNotFoundError(f"Container or network not found: {str(e)}")
        except APIError as e:
            raise DockerServiceError(f"Failed to connect container to network: {str(e)}")

    def disconnect_container_from_network(self, container_id: str, network_name: str) -> Dict[str, str]:
        """Disconnect a container from a network"""
        try:
            container = self.client.containers.get(container_id)
            network = self.client.networks.get(network_name)
            network.disconnect(container)
            return {"status": "success", "message": f"Container disconnected from network {network_name}"}
        except NotFound as e:
            raise DockerNotFoundError(f"Container or network not found: {str(e)}")
        except APIError as e:
            raise DockerServiceError(f"Failed to disconnect container from network: {str(e)}")

    def get_system_df(self) -> Dict[str, Any]:
        """Get docker system df information"""
        try:
            df = self.client.df()
            return {
                "images": {
                    "total_size": sum(img.get('Size', 0) for img in df.get('Images', [])),
                    "count": len(df.get('Images', [])),
                    "reclaimable": sum(img.get('Size', 0) for img in df.get('Images', []) if img.get('Containers', 0) == 0)
                },
                "containers": {
                    "total_size": sum(c.get('SizeRw', 0) for c in df.get('Containers', [])),
                    "count": len(df.get('Containers', [])),
                    "reclaimable": sum(c.get('SizeRw', 0) for c in df.get('Containers', []) if c.get('State') != 'running')
                },
                "volumes": {
                    "total_size": sum(v.get('UsageData', {}).get('Size', 0) for v in df.get('Volumes', [])),
                    "count": len(df.get('Volumes', [])),
                    "reclaimable": sum(v.get('UsageData', {}).get('Size', 0) for v in df.get('Volumes', []) if v.get('UsageData', {}).get('RefCount', 0) == 0)
                },
                "build_cache": {
                    "total_size": sum(b.get('Size', 0) for b in df.get('BuildCache', [])),
                    "count": len(df.get('BuildCache', [])),
                    "reclaimable": sum(b.get('Size', 0) for b in df.get('BuildCache', []))
                }
            }
        except Exception:
            logger.warning("Failed to get Docker system df", exc_info=True)
            return {"images": {}, "containers": {}, "volumes": {}, "build_cache": {}}

    def rename_container(self, container_id: str, new_name: str) -> Dict[str, str]:
        """Rename a container"""
        try:
            container = self.client.containers.get(container_id)
            container.rename(new_name)
            return {"status": "success", "message": f"Container renamed to {new_name}"}
        except NotFound:
            raise DockerNotFoundError(f"Container {container_id} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to rename container: {str(e)}")

    def tag_image(self, image_id: str, repository: str, tag: str = "latest") -> Dict[str, str]:
        """Tag a Docker image"""
        try:
            image = self.client.images.get(image_id)
            image.tag(repository, tag)
            return {"status": "success", "message": f"Image tagged as {repository}:{tag}"}
        except NotFound:
            raise DockerNotFoundError(f"Image {image_id} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to tag image: {str(e)}")

    def pull_image(self, repository: str, tag: str = "latest") -> Dict[str, str]:
        """Pull a Docker image"""
        try:
            image = self.client.images.pull(repository, tag)
            return {"status": "success", "message": f"Image {repository}:{tag} pulled", "id": image.short_id}
        except APIError as e:
            raise DockerServiceError(f"Failed to pull image: {str(e)}")

    def push_image(self, repository: str, tag: str = "latest") -> Dict[str, str]:
        """Push a Docker image"""
        try:
            self.client.images.push(repository, tag)
            return {"status": "success", "message": f"Image {repository}:{tag} pushed"}
        except APIError as e:
            raise DockerServiceError(f"Failed to push image: {str(e)}")

    def delete_image(self, image_id: str, force: bool = False) -> Dict[str, str]:
        """Delete a Docker image"""
        try:
            self.client.images.remove(image_id, force=force)
            return {"status": "success", "message": f"Image {image_id} deleted"}
        except NotFound:
            raise DockerNotFoundError(f"Image {image_id} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to delete image: {str(e)}")

    def prune_images(self, dangling_only: bool = True) -> Dict[str, Any]:
        """Prune unused Docker images"""
        try:
            filters = {"dangling": dangling_only}
            result = self.client.images.prune(filters=filters)
            deleted = result.get("ImagesDeleted", []) or []
            command = "docker image prune -f"
            if not dangling_only:
                command = "docker image prune -a -f"
            return {
                "status": "success",
                "action": "image_prune",
                "command": command,
                "message": "Images pruned",
                "output": self._format_prune_output(
                    command,
                    [
                        f"Deleted images: {len(deleted)}",
                        f"Space reclaimed: {result.get('SpaceReclaimed', 0)} bytes",
                    ],
                ),
                "images_deleted": deleted,
                "space_reclaimed": result.get("SpaceReclaimed", 0),
            }
        except APIError as e:
            raise DockerServiceError(f"Failed to prune images: {str(e)}")

    def prune_volumes(self, force: bool = False) -> Dict[str, Any]:
        """Prune unused Docker volumes."""
        try:
            result = self.client.volumes.prune()
            deleted = result.get("VolumesDeleted", []) or []
            command = "docker volume prune -f" if force else "docker volume prune"
            return {
                "status": "success",
                "action": "volume_prune",
                "command": command,
                "message": "Volumes pruned",
                "output": self._format_prune_output(
                    command,
                    [
                        f"Deleted volumes: {len(deleted)}",
                        f"Space reclaimed: {result.get('SpaceReclaimed', 0)} bytes",
                    ],
                ),
                "volumes_deleted": deleted,
                "space_reclaimed": result.get("SpaceReclaimed", 0),
            }
        except APIError as e:
            raise DockerServiceError(f"Failed to prune volumes: {str(e)}")

    def prune_builder_cache(self, force: bool = False) -> Dict[str, Any]:
        """Prune Docker builder cache."""
        try:
            try:
                result = self.client.api.prune_builds(all=force)
            except TypeError:
                result = self.client.api.prune_builds()
            deleted = result.get("CachesDeleted", []) or []
            command = "docker builder prune -f"
            if force:
                command = "docker builder prune -a -f"
            return {
                "status": "success",
                "action": "builder_prune",
                "command": command,
                "message": "Builder cache pruned",
                "output": self._format_prune_output(
                    command,
                    [
                        f"Deleted cache entries: {len(deleted)}",
                        f"Space reclaimed: {result.get('SpaceReclaimed', 0)} bytes",
                    ],
                ),
                "caches_deleted": deleted,
                "space_reclaimed": result.get("SpaceReclaimed", 0),
            }
        except APIError as e:
            raise DockerServiceError(f"Failed to prune builder cache: {str(e)}")

    def prune_system(self, force: bool = False) -> Dict[str, Any]:
        """Prune Docker system resources."""
        try:
            containers_result = self.client.containers.prune()
            images_result = self.client.images.prune(filters={"dangling": not force})
            networks_result = self.client.networks.prune()
            volumes_result = (
                self.client.volumes.prune()
                if force
                else {"VolumesDeleted": [], "SpaceReclaimed": 0}
            )
            try:
                build_result = self.client.api.prune_builds(all=force)
            except TypeError:
                build_result = self.client.api.prune_builds()

            total_reclaimed = sum(
                int(result.get("SpaceReclaimed", 0) or 0)
                for result in (
                    containers_result,
                    images_result,
                    networks_result,
                    volumes_result,
                    build_result,
                )
            )
            command = "docker system prune -f"
            if force:
                command = "docker system prune -a --volumes -f"

            return {
                "status": "success",
                "action": "system_prune",
                "command": command,
                "message": "System prune completed",
                "output": self._format_prune_output(
                    command,
                    [
                        f"Deleted containers: {len(containers_result.get('ContainersDeleted', []) or [])}",
                        f"Deleted images: {len(images_result.get('ImagesDeleted', []) or [])}",
                        f"Deleted networks: {len(networks_result.get('NetworksDeleted', []) or [])}",
                        f"Deleted volumes: {len(volumes_result.get('VolumesDeleted', []) or [])}",
                        f"Deleted build cache entries: {len(build_result.get('CachesDeleted', []) or [])}",
                        f"Space reclaimed: {total_reclaimed} bytes",
                    ],
                ),
                "space_reclaimed": total_reclaimed,
                "details": {
                    "containers": containers_result,
                    "images": images_result,
                    "networks": networks_result,
                    "volumes": volumes_result,
                    "build_cache": build_result,
                },
            }
        except APIError as e:
            raise DockerServiceError(f"Failed to run system prune: {str(e)}")

    def delete_network(self, network_id: str) -> Dict[str, str]:
        """Delete a Docker network"""
        try:
            network = self.client.networks.get(network_id)
            attrs = network.attrs
            if attrs.get("Containers"):
                raise DockerValidationError(
                    "Cannot delete network with connected containers. Disconnect all containers first."
                )
            network.remove()
            return {"status": "success", "message": f"Network {network_id} deleted"}
        except NotFound:
            raise DockerNotFoundError(f"Network {network_id} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to delete network: {str(e)}")

    def delete_volume(self, volume_name: str, force: bool = False) -> Dict[str, str]:
        """Delete a Docker volume"""
        try:
            volume = self.client.volumes.get(volume_name)
            volume.remove(force=force)
            return {"status": "success", "message": f"Volume {volume_name} deleted"}
        except NotFound:
            raise DockerNotFoundError(f"Volume {volume_name} not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to delete volume: {str(e)}")

    def attach_volume_to_container(self, container_id: str, volume_name: str, mount_point: str, mode: str = "rw") -> Dict[str, str]:
        """Attach a volume to a container (requires container recreation)"""
        try:
            container = self.client.containers.get(container_id)
            attrs = container.attrs

            # Get current mounts
            mounts = attrs.get('Mounts', [])

            # Check if already mounted
            for mount in mounts:
                if mount.get("Source") == volume_name:
                    raise DockerValidationError(
                        f"Volume {volume_name} is already attached to this container"
                    )

            # Need to recreate container with new volume
            config = attrs['Config']
            host_config = attrs['HostConfig']

            # Stop and remove old container
            was_running = container.status == 'running'
            if was_running:
                container.stop()
            container.remove()

            # Prepare volume binds
            binds = host_config.get('Binds', [])
            binds.append(f"{volume_name}:{mount_point}:{mode}")

            # Create new container
            new_container = self.client.containers.create(
                image=config['Image'],
                name=container.name,
                environment=config.get('Env', []),
                ports=host_config.get('PortBindings', {}),
                volumes={mount_point: {}},
                host_config=self.client.api.create_host_config(binds=binds)
            )

            if was_running:
                new_container.start()

            return {"status": "success", "message": f"Volume {volume_name} attached to container"}
        except NotFound:
            raise DockerNotFoundError("Container or volume not found")
        except APIError as e:
            raise DockerServiceError(f"Failed to attach volume: {str(e)}")

    def create_from_compose(self, compose_content: str) -> Dict[str, str]:
        """Create containers from docker-compose content"""
        try:
            self._validate_compose_payload(compose_content)

            # Create temporary directory for compose file
            with tempfile.TemporaryDirectory() as tmpdir:
                compose_file = Path(tmpdir) / "docker-compose.yml"
                compose_file.write_text(compose_content)

                import subprocess

                try:
                    result = subprocess.run(
                        ["docker-compose", "up", "-d"],
                        cwd=tmpdir,
                        capture_output=True,
                        text=True,
                    )
                except FileNotFoundError as e:
                    raise DockerServiceError(
                        "docker-compose binary not found inside backend container. "
                        "Ensure the docker-compose package is installed and available in PATH."
                    ) from e

                if result.returncode != 0:
                    raise DockerServiceError(f"Failed to create containers: {result.stderr}")

                return {
                    "status": "success",
                    "message": "Container stack created successfully",
                    "output": result.stdout,
                }
        except DockerServiceError:
            raise
        except Exception as e:
            raise DockerServiceError(f"Failed to create from compose: {str(e)}") from e

    def build_image(self, dockerfile_content: str, tag: str) -> Dict[str, str]:
        """Build a Docker image from Dockerfile content"""
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                dockerfile_path = Path(tmpdir) / "Dockerfile"
                dockerfile_path.write_text(dockerfile_content)

                image, build_logs = self.client.images.build(
                    path=tmpdir,
                    tag=tag,
                    rm=True,
                    forcerm=True,
                )

                logs = []
                for log in build_logs:
                    if 'stream' in log:
                        logs.append(log["stream"].strip())

                return {
                    "status": "success",
                    "message": f"Image {tag} built successfully",
                    "image_id": image.short_id,
                    "logs": logs,
                }
        except APIError as e:
            raise DockerServiceError(f"Failed to build image: {str(e)}")
        except Exception as e:
            raise DockerServiceError(f"Failed to build image: {str(e)}")


docker_service = DockerService()
