"""WASM-based PoW solver for the DeepSeek vendor core."""
import struct
import threading
from pathlib import Path

from wasmtime import Instance, Module, Store

from .errors import PoWError
from .logger import get_logger

# invariant: logger name must stay "adapter" (ds2api.adapter) after the split
log = get_logger("adapter")

_WASM_PATH = Path(__file__).resolve().parent / "sha3_wasm_bg.wasm"
with open(_WASM_PATH, "rb") as f:
    _WASM_BYTES = f.read()


class _WASMSolver:
    """WASM-based PoW solver (reused across calls) — thread-safe via lock."""

    def __init__(self):
        self._lock = threading.Lock()
        self.store = Store()
        module = Module(self.store.engine, _WASM_BYTES)
        instance = Instance(self.store, module, [])
        exports = instance.exports(self.store)
        self.memory = exports["memory"]
        self.wasm_solve = exports["wasm_solve"]
        self.add_to_stack = exports["__wbindgen_add_to_stack_pointer"]
        self.malloc = exports["__wbindgen_export_0"]
        self._wbindgen_free = exports["__wbindgen_export_2"]
        self._allocations: list[tuple[int, int]] = []

    def _encode(self, s: str):
        data = s.encode("utf-8")
        ptr = self.malloc(self.store, len(data), 1)
        mem = self.memory.data_ptr(self.store)
        for i, b in enumerate(data):
            mem[ptr + i] = b
        self._allocations.append((ptr, len(data)))
        return ptr, len(data)

    def _free_allocations(self):
        for ptr, length in self._allocations:
            try:
                self._wbindgen_free(self.store, ptr, length, 1)
            except Exception as e:
                log.debug("wasm_free_failed", extra={"ptr": ptr, "length": length, "error": str(e)})
        self._allocations.clear()

    def solve(self, challenge: str, salt: str, expire_at: int, difficulty: int) -> int:
        with self._lock:
            try:
                prefix = f"{salt}_{expire_at}_"
                stack_ptr = self.add_to_stack(self.store, -16)
                chal_ptr, chal_len = self._encode(challenge)
                prefix_ptr, prefix_len = self._encode(prefix)
                self.wasm_solve(self.store, stack_ptr, chal_ptr, chal_len,
                                prefix_ptr, prefix_len, float(difficulty))
                mem = self.memory.data_ptr(self.store)
                ret = int.from_bytes(bytes(mem[stack_ptr:stack_ptr + 4]),
                                     byteorder='little', signed=True)
                if ret == 0:
                    raise PoWError("WASM solver found no solution")
                result = struct.unpack('<d', bytes(mem[stack_ptr + 8:stack_ptr + 16]))[0]
                self.add_to_stack(self.store, 16)
                return int(result)
            finally:
                self._free_allocations()
