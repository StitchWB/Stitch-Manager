"""v2-era inline RpcPluginServer fallback block (upgrade detection)."""

# Byte-exact v2-era inline fallback for upgrade detection; standalone, NOT derived from the v3 _MAIN_TEMPLATE.
_FALLBACK_ANCHOR_START = "try:\n    from autoreg.plugin.rpc import RpcPluginServer"
_FALLBACK_ANCHOR_END = "\n\n\n# ── State received"
_V2_FALLBACK_TEMPLATE = '''try:
    from autoreg.plugin.rpc import RpcPluginServer
except ImportError:
    import threading
    import time

    class RpcPluginServer:
        """Inline stdio JSON-RPC 2.0 server (protocol-equivalent fallback).

        Handles plugin.init/ping/shutdown/call dispatch, handler
        exceptions → -32603, unknown method → -32601, and reverse-RPC
        call_host with queued-line processing.  Uses
        sys.stdin.readline() (not ``for line in sys.stdin``) so call_host
        can interleave reads without the iterator's buffering.
        """

        def __init__(self) -> None:
            self._handlers: dict[str, Any] = {{}}
            self._init_handler: Any = None
            self._request_handlers: dict[str, Any] = {{}}
            self._next_request_id = 1
            self._request_id_lock = threading.Lock()
            self._queued_lines: list[str] = []

        def register(self, name: str, handler: Any) -> None:
            self._handlers[name] = handler

        def set_init_handler(self, handler: Any) -> None:
            self._init_handler = handler

        def set_request_handler(self, name: str, handler: Any) -> None:
            self._request_handlers[name] = handler

        def _next_request_id_locked(self) -> int:
            with self._request_id_lock:
                rid = self._next_request_id
                self._next_request_id += 1
                return rid

        def call_host(self, method: str, params: dict[str, Any] | None = None, timeout: float = 30.0) -> Any:
            rid = self._next_request_id_locked()
            req = {{"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {{}}}}
            sys.stdout.write(json.dumps(req, ensure_ascii=False) + "\\n")
            sys.stdout.flush()
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                raw = sys.stdin.readline()
                if not raw:
                    raise RuntimeError("stdin closed while waiting for host response")
                line = raw.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if not isinstance(obj, dict):
                    continue
                obj_id = obj.get("id")
                has_result = "result" in obj
                has_error = "error" in obj and obj["error"] is not None
                obj_method = obj.get("method")
                if obj_id == rid and has_result and obj_method is None:
                    return obj["result"]
                if obj_id == rid and has_error and obj_method is None:
                    err = obj["error"]
                    if isinstance(err, dict):
                        raise RuntimeError(f"host error [{{err.get('code', -32603)}}]: {{err.get('message', '')}}")
                    raise RuntimeError(str(err))
                self._queued_lines.append(line)
            raise TimeoutError(f"call_host {{method}} (id={{rid}}) timed out after {{timeout}}s")

        def serve(self) -> None:
            while True:
                while self._queued_lines:
                    queued = self._queued_lines.pop(0)
                    if self._process_line(queued):
                        return
                raw = sys.stdin.readline()
                if not raw:
                    break
                line = raw.strip()
                if not line:
                    continue
                if self._process_line(line):
                    return

        def _process_line(self, line: str) -> bool:
            try:
                req = json.loads(line)
            except (ValueError, TypeError):
                return False
            if not isinstance(req, dict):
                return False
            rid = req.get("id")
            method = req.get("method", "")
            params = req.get("params", {{}})
            if not isinstance(params, dict):
                params = {{}}
            result = self._dispatch(method, params)
            self._send_response(rid, result)
            return method == "plugin.shutdown"

        def _dispatch(self, method: str, params: dict[str, Any]) -> Any:
            try:
                if method == "plugin.init":
                    if self._init_handler is not None:
                        return self._init_handler(params)
                    return params
                if method == "plugin.ping":
                    return "pong"
                if method == "plugin.shutdown":
                    return None
                if method == "plugin.call":
                    name = params.get("name", "")
                    args = params.get("params", {{}})
                    if not isinstance(args, dict):
                        args = {{}}
                    handler = self._handlers.get(name)
                    if handler is None:
                        return {{"error": {{"code": -32601, "message": f"method not found: {{name}}"}}}}
                    return handler(args)
                return {{"error": {{"code": -32601, "message": f"unknown method: {{method}}"}}}}
            except Exception as exc:  # noqa: BLE001
                return {{"error": {{"code": -32603, "message": str(exc)}}}}

        @staticmethod
        def _send_response(rid: Any, result: Any) -> None:
            err = result.get("error") if isinstance(result, dict) else None
            if isinstance(err, dict) and "code" in err and "message" in err:
                obj = {{"jsonrpc": "2.0", "id": rid, "error": err}}
            else:
                obj = {{"jsonrpc": "2.0", "id": rid, "result": result}}
            sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\\n")
            sys.stdout.flush()
'''
_RPC_FALLBACK_BLOCK = (
    _V2_FALLBACK_TEMPLATE
    .replace("{{", "{")
    .replace("}}", "}")
    .rstrip("\n")
    + "\n"
)
