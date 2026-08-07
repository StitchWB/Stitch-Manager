"""
Local proxy wrapper that adds authentication to upstream proxy.
This allows Chrome to connect without authentication dialog.
"""

import base64
import logging
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

logger = logging.getLogger(__name__)


class ProxyHandler(BaseHTTPRequestHandler):
    """HTTP proxy handler that forwards requests with authentication"""

    def __init__(self, *args, upstream_host=None, upstream_port=None,
                 username=None, password=None, **kwargs):
        self.upstream_host = upstream_host
        self.upstream_port = upstream_port
        self.username = username
        self.password = password
        super().__init__(*args, **kwargs)

    def log_message(self, format, *args):
        """Suppress default logging"""
        pass

    def do_CONNECT(self):
        """Handle CONNECT method for HTTPS"""
        try:
            # Connect to upstream proxy
            upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            upstream.connect((self.upstream_host, self.upstream_port))

            # Send CONNECT request with auth
            auth_str = f"{self.username}:{self.password}"
            auth_b64 = base64.b64encode(auth_str.encode()).decode()

            connect_req = f"CONNECT {self.path} HTTP/1.1\r\n"
            connect_req += f"Host: {self.path}\r\n"
            connect_req += f"Proxy-Authorization: Basic {auth_b64}\r\n"
            connect_req += "Proxy-Connection: keep-alive\r\n"
            connect_req += "\r\n"

            upstream.sendall(connect_req.encode())

            # Read response from upstream
            response = b""
            while b"\r\n\r\n" not in response:
                chunk = upstream.recv(4096)
                if not chunk:
                    break
                response += chunk

            # Check if connection established
            if b"200" in response.split(b"\r\n")[0]:
                # Send 200 to client
                self.send_response(200, "Connection Established")
                self.end_headers()

                # Start bidirectional forwarding
                self._forward_data(self.connection, upstream)
            else:
                self.send_error(502, "Bad Gateway")

        except Exception as e:
            logger.error(f"CONNECT error: {e}")
            self.send_error(502, "Bad Gateway")

    def do_GET(self):
        """Handle GET method"""
        self._proxy_request()

    def do_POST(self):
        """Handle POST method"""
        self._proxy_request()

    def do_HEAD(self):
        """Handle HEAD method"""
        self._proxy_request()

    def do_PUT(self):
        """Handle PUT method"""
        self._proxy_request()

    def do_DELETE(self):
        """Handle DELETE method"""
        self._proxy_request()

    def _proxy_request(self):
        """Forward HTTP request to upstream proxy with authentication"""
        try:
            # Connect to upstream proxy
            upstream = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            upstream.connect((self.upstream_host, self.upstream_port))

            # Build request with auth
            auth_str = f"{self.username}:{self.password}"
            auth_b64 = base64.b64encode(auth_str.encode()).decode()

            # Reconstruct request
            request = f"{self.command} {self.path} HTTP/1.1\r\n"

            # Add headers
            for header, value in self.headers.items():
                if header.lower() not in ['proxy-connection', 'proxy-authorization']:
                    request += f"{header}: {value}\r\n"

            # Add proxy auth
            request += f"Proxy-Authorization: Basic {auth_b64}\r\n"
            request += "\r\n"

            # Send request
            upstream.sendall(request.encode())

            # Read body if present
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length > 0:
                body = self.rfile.read(content_length)
                upstream.sendall(body)

            # Forward response
            response = b""
            while True:
                chunk = upstream.recv(4096)
                if not chunk:
                    break
                response += chunk
                self.wfile.write(chunk)
                if len(chunk) < 4096:
                    break

            upstream.close()

        except Exception as e:
            logger.error(f"Proxy request error: {e}")
            self.send_error(502, "Bad Gateway")

    def _forward_data(self, client, server):
        """Bidirectional data forwarding for CONNECT"""
        def forward(source, destination):
            try:
                while True:
                    data = source.recv(4096)
                    if not data:
                        break
                    destination.sendall(data)
            except Exception:
                pass
            finally:
                try:
                    source.close()
                    destination.close()
                except Exception:
                    pass

        # Start forwarding threads
        client_to_server = threading.Thread(target=forward, args=(client, server))
        server_to_client = threading.Thread(target=forward, args=(server, client))

        client_to_server.daemon = True
        server_to_client.daemon = True

        client_to_server.start()
        server_to_client.start()

        client_to_server.join()
        server_to_client.join()


class LocalProxyServer:
    """Local proxy server that adds authentication to upstream proxy"""

    def __init__(self, upstream_host: str, upstream_port: int,
                 username: str, password: str, local_port: int = 0):
        self.upstream_host = upstream_host
        self.upstream_port = upstream_port
        self.username = username
        self.password = password
        self.local_port = local_port
        self.server = None
        self.thread = None

    def start(self) -> int:
        """Start proxy server and return local port"""
        # Create handler with upstream config
        def handler(*args, **kwargs):
            return ProxyHandler(*args,
                              upstream_host=self.upstream_host,
                              upstream_port=self.upstream_port,
                              username=self.username,
                              password=self.password,
                              **kwargs)

        # Create server
        self.server = HTTPServer(('127.0.0.1', self.local_port), handler)
        self.local_port = self.server.server_address[1]

        # Start in background thread
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

        logger.info(f"Local proxy started on 127.0.0.1:{self.local_port} -> {self.upstream_host}:{self.upstream_port}")
        return self.local_port

    def stop(self):
        """Stop proxy server"""
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            logger.info("Local proxy stopped")
