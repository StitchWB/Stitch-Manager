import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

from stitch_backend.domains.ai_gateway.schemas import SaveConnectionRequest

spec = importlib.util.spec_from_file_location("connection_smoke", Path(__file__).resolve().parents[2] / "scripts/e2e-ai-connection.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class Backend:
    def __init__(self, sabotage=None):
        self.rows = {}
        self.auth = {}
        self.sabotage = sabotage
        self.next_id = 0

    def post(self, name, body):
        if name == "save_connection":
            req = SaveConnectionRequest.model_validate(body)
            existing = next((row for row in self.rows.values() if row["baseUrl"] == req.base_url), None)
            created = existing is None or self.sabotage == "dedup"
            if created:
                self.next_id += 1
                row = {"id": str(self.next_id), "name": req.name, "baseUrl": req.base_url}
                self.rows[row["id"]] = row
                self.auth[row["id"]] = req.auth.type
            else:
                row = existing
            return {"endpoint": row, "credentialsCreated": int(created), "credentialsExisting": int(not created)}
        if name == "list_provider_endpoints":
            rows = list(self.rows.values())
            return rows + rows[:1] if self.sabotage == "duplicate_rows" else rows
        if name == "get_provider_endpoint":
            return self.rows[body["id"]]
        if name == "list_credentials":
            return [{"authType": self.auth[body["providerEndpointId"]]}]
        if name == "delete_provider_endpoint":
            self.rows.pop(body["id"])
            return {}
        raise AssertionError(f"Unexpected command {name}")


def test_happy_path():
    backend = Backend()
    smoke.run_smoke(backend.post)
    assert backend.rows == {}


def test_detects_dedup_violation():
    backend = Backend("dedup")
    with pytest.raises(AssertionError, match="did NOT dedup"):
        smoke.run_smoke(backend.post)
    assert backend.rows == {}


def test_detects_duplicate_rows_in_list():
    backend = Backend("duplicate_rows")
    with pytest.raises(AssertionError, match="appeared 2 times"):
        smoke.run_smoke(backend.post)
    assert backend.rows == {}


def test_cleans_up_on_assertion_failure():
    backend = Backend("duplicate_rows")
    with pytest.raises(AssertionError):
        smoke.run_smoke(backend.post)
    assert backend.rows == {}


def test_real_isolated_backend():
    result = subprocess.run(
        [sys.executable, str(Path(smoke.__file__))],
        capture_output=True, text=True, timeout=85,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "[OK] Real HTTP" in result.stdout
