import socket

import pytest

from tripai.serve import dual_stack_socket


def test_dual_stack_socket_accepts_ipv4_and_ipv6():
    sock = dual_stack_socket(0)
    try:
        if sock.family != socket.AF_INET6:
            pytest.skip("no IPv6 on this host")
        sock.listen()
        port = sock.getsockname()[1]
        for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
            with socket.socket(family, socket.SOCK_STREAM) as c:
                c.settimeout(2)
                c.connect((host, port))
                conn, _ = sock.accept()
                conn.close()
    finally:
        sock.close()
