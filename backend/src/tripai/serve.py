"""Production entrypoint (Dockerfile.backend): `python -m tripai.serve`, port from $PORT (default 8000).

Listens dual-stack on `[::]` with IPV6_V6ONLY off, so one socket takes IPv6 (Railway private
networking) and IPv4 (public proxy, health checks). `uvicorn --host ::` is not enough: asyncio forces
IPV6_V6ONLY on, which drops IPv4. Falls back to 0.0.0.0 where the host has no IPv6.
"""

import logging
import os
import socket

import uvicorn

log = logging.getLogger(__name__)


def dual_stack_socket(port: int) -> socket.socket:
    try:
        sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        addr: tuple = ("::", port)
    except OSError:  # no IPv6 on this host
        log.warning("IPv6 unavailable, listening on IPv4 only")
        sock, addr = socket.socket(socket.AF_INET, socket.SOCK_STREAM), ("0.0.0.0", port)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(addr)
    sock.set_inheritable(True)
    return sock


def main() -> None:
    port = int(os.getenv("PORT") or 8000)
    sock = dual_stack_socket(port)
    server = uvicorn.Server(uvicorn.Config("tripai.main:app"))
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
