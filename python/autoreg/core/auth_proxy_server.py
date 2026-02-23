"""
Local proxy server that adds authentication to upstream proxy.
Chrome connects to this local proxy without auth,
and this proxy forwards requests to upstream proxy with auth.
"""

import logging
import select
import socket
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

logger = logging.getLogger(__name__)


class ProxyAuthHandler(BaseHTTPRequestHandler):
    """HTTP proxy handler that adds authentication"""

    upstream_proxy: str | None = None  # Format: "http://user:pass@host:port"

    def log_message(self, format, *args):
        """Suppress default logging"""
        pass

    def do_CONNECT(self):
        """Handle HTTPS CONNECT requests"""
        upstream: socket.socket | None = None
        tunnel_established = False
        try:
            # Parse target host and port
            host, port = self.path.split(":")
            port = int(port)

            # Connect to upstream proxy
            if self.upstream_proxy:
                # Parse upstream proxy
                import urllib.parse

                parsed = urllib.parse.urlparse(self.upstream_proxy)
                proxy_host = parsed.hostname
                proxy_port = parsed.port or 8080
                proxy_user = parsed.username
                proxy_pass = parsed.password

                # Connect to upstream proxy
                upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                upstream.settimeout(15)
                upstream.connect((proxy_host, proxy_port))

                # Send CONNECT request with auth
                connect_req = f"CONNECT {host}:{port} HTTP/1.1\r\n"
                connect_req += f"Host: {host}:{port}\r\n"
                if proxy_user and proxy_pass:
                    import base64

                    auth = base64.b64encode(f"{proxy_user}:{proxy_pass}".encode()).decode()
                    connect_req += f"Proxy-Authorization: Basic {auth}\r\n"
                connect_req += "\r\n"

                upstream.send(connect_req.encode())

                # Read response headers
                response = b""
                while b"\r\n\r\n" not in response:
                    response += upstream.recv(1024)

                # Check if connection established
                if b"200" not in response.split(b"\r\n")[0]:
                    self.send_error(502, "Proxy connection failed")
                    upstream.close()
                    return
            else:
                # Direct connection (no upstream proxy)
                upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                upstream.connect((host, port))

            # Send 200 OK to client
            self.send_response(200, "Connection established")
            self.end_headers()
            tunnel_established = True

            # Tunnel data in both directions until either side closes.
            # Use select loop to avoid thread join deadlocks under keep-alive traffic.
            self.connection.settimeout(0.0)
            upstream.settimeout(0.0)

            sockets = [self.connection, upstream]
            while True:
                readable, _, exceptional = select.select(sockets, [], sockets, 60)
                if exceptional:
                    break
                if not readable:
                    continue

                for sock in readable:
                    try:
                        data = sock.recv(8192)
                    except BlockingIOError:
                        continue
                    if not data:
                        return

                    if sock is self.connection:
                        upstream.sendall(data)
                    else:
                        self.connection.sendall(data)

        except Exception as e:
            win_error = getattr(e, "winerror", None)
            is_disconnect = win_error in (10053, 10054) or isinstance(
                e, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)
            )

            if is_disconnect:
                logger.debug(f"CONNECT tunnel disconnected: {e}")
                return

            logger.error(f"CONNECT error: {e}")
            if not tunnel_established:
                try:
                    self.send_error(502, "Proxy tunnel error")
                except Exception:
                    pass
        finally:
            try:
                if upstream:
                    upstream.close()
            except Exception:
                pass

    def do_GET(self):
        """Handle HTTP GET requests"""
        self._proxy_request()

    def do_POST(self):
        """Handle HTTP POST requests"""
        self._proxy_request()

    def do_PUT(self):
        """Handle HTTP PUT requests"""
        self._proxy_request()

    def do_DELETE(self):
        """Handle HTTP DELETE requests"""
        self._proxy_request()

    def _proxy_request(self):
        """Forward HTTP request through upstream proxy"""
        try:
            # Build request
            url = self.path
            if not url.startswith("http"):
                url = f"http://{self.headers.get('Host')}{url}"

            # Create request with proxy
            if self.upstream_proxy:
                proxy_handler = urllib.request.ProxyHandler(
                    {"http": self.upstream_proxy, "https": self.upstream_proxy}
                )
                opener = urllib.request.build_opener(proxy_handler)
            else:
                opener = urllib.request.build_opener()

            # Copy headers
            headers = {}
            for key, value in self.headers.items():
                if key.lower() not in ["proxy-connection", "proxy-authorization"]:
                    headers[key] = value

            # Read body if present
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else None

            # Make request
            req = urllib.request.Request(url, data=body, headers=headers, method=self.command)
            response = opener.open(req, timeout=30)

            # Send response
            self.send_response(response.status)
            for key, value in response.headers.items():
                self.send_header(key, value)
            self.end_headers()

            # Send body
            self.wfile.write(response.read())

        except urllib.error.HTTPError as e:
            self.send_error(e.code, e.reason)
        except Exception as e:
            logger.error(f"Proxy request error: {e}")
            self.send_error(502, str(e))


class AuthProxyServer:
    """Local proxy server with upstream authentication"""

    def __init__(
        self,
        upstream_host: str,
        upstream_port: int,
        upstream_user: str | None = None,
        upstream_pass: str | None = None,
        local_port: int = 0,
    ):
        """
        Initialize proxy server.

        Args:
            upstream_host: Upstream proxy host
            upstream_port: Upstream proxy port
            upstream_user: Upstream proxy username (optional)
            upstream_pass: Upstream proxy password (optional)
            local_port: Local port to bind (0 = auto-assign)
        """
        self.upstream_host = upstream_host
        self.upstream_port = upstream_port
        self.upstream_user = upstream_user
        self.upstream_pass = upstream_pass
        self.local_port = local_port
        self.server = None
        self.thread = None

        # Build upstream proxy URL
        if upstream_user and upstream_pass:
            self.upstream_url = (
                f"http://{upstream_user}:{upstream_pass}@{upstream_host}:{upstream_port}"
            )
        else:
            self.upstream_url = f"http://{upstream_host}:{upstream_port}"

    def start(self) -> tuple[str, int]:
        """
        Start proxy server.

        Returns:
            Tuple of (host, port) where server is listening
        """
        # Set upstream proxy for handler
        ProxyAuthHandler.upstream_proxy = self.upstream_url

        # Create server
        self.server = ThreadingHTTPServer(("127.0.0.1", self.local_port), ProxyAuthHandler)
        actual_port = self.server.server_address[1]

        logger.info(f"Starting local proxy server on 127.0.0.1:{actual_port}")
        logger.info(f"Forwarding to: {self.upstream_host}:{self.upstream_port}")

        # Start server in background thread
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

        return ("127.0.0.1", actual_port)

    def stop(self):
        """Stop proxy server"""
        if self.server:
            logger.info("Stopping local proxy server")
            self.server.shutdown()
            self.server.server_close()
            self.server = None

        if self.thread:
            self.thread.join(timeout=2)
            self.thread = None
