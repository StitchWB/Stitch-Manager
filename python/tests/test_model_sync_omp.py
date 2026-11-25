"""OMP writer tests: models.yml/config.yml, profiles, env path resolution."""

from __future__ import annotations

from pathlib import Path

import pytest

from stitch_backend.domains.ai_proxy.model_sync import omp

ENTRY = {
    "id": "vision-best",
    "name": "Vision Best",
    "contextTokens": 200000,
    "outputTokens": 40000,
    "outputTokensExplicit": True,
    "inputModalities": ["text", "image"],
    "outputModalities": ["text"],
    "tools": True,
    "reasoning": None,
}
ENTRY2 = {
    "id": "text-fast",
    "name": "Text Fast",
    "contextTokens": 128000,
    "outputTokens": 8192,
    "outputTokensExplicit": False,
    "inputModalities": ["text"],
    "outputModalities": ["text"],
    "tools": True,
    "reasoning": None,
}
BASE = "http://127.0.0.1:8787/v1"
KEY = "secret-token-xyz"


def test_build_omp_model_entry() -> None:
    built = omp.build_omp_model_entry(ENTRY)
    assert built["id"] == "vision-best"
    assert built["input"] == ["text", "image"]
    assert built["contextWindow"] == 200000
    assert built["maxTokens"] == 32768  # capped
    assert built["supportsTools"] is True
    assert "reasoning" not in built

    built2 = omp.build_omp_model_entry(ENTRY2)
    assert built2["input"] == ["text"]
    assert built2["maxTokens"] == 16384  # fallback when not explicit


def test_models_yaml_empty_write() -> None:
    data = omp.CommentedMap()
    updated, diff = omp.update_models_yaml(data, [ENTRY], BASE, KEY, prune_unselected=False)
    stitch = updated["providers"]["stitch"]
    assert stitch["baseUrl"] == BASE
    assert stitch["api"] == "openai-completions"
    assert stitch["apiKey"] == KEY  # literal token — status-quo
    assert stitch["authHeader"] is True
    assert stitch["auth"] == "apiKey"
    assert [m["id"] for m in stitch["models"]] == ["vision-best"]
    assert diff["added"] == ["vision-best"]


def test_models_yaml_preserves_comments_and_unknown_keys(tmp_path: Path) -> None:
    path = tmp_path / "models.yml"
    path.write_text(
        "# top comment — must survive\n"
        "providers:\n"
        "  stitch:\n"
        "    baseUrl: http://old\n"
        "    customProviderKey: keepme\n"
        "    models:\n"
        "    - id: vision-best\n"
        "      name: Old Name\n"
        "      customKey: preserved\n"
        "      input:\n"
        "      - text\n"
        "    - id: stale-model\n"
        "      name: Stale\n"
        "  otherprovider:\n"
        "    baseUrl: http://other\n",
        encoding="utf-8",
    )
    data = omp.load_yaml_rt(path)
    updated, diff = omp.update_models_yaml(
        data, [ENTRY], BASE, KEY, prune_unselected=True
    )
    text = omp.dump_yaml_rt(updated)
    assert "top comment — must survive" in text
    stitch = updated["providers"]["stitch"]
    assert stitch["customProviderKey"] == "keepme"  # unrelated provider-level key
    assert updated["providers"]["otherprovider"]["baseUrl"] == "http://other"
    models = {m["id"]: m for m in stitch["models"]}
    assert "stale-model" not in models  # pruned
    assert models["vision-best"]["customKey"] == "preserved"  # unknown key survives
    assert models["vision-best"]["name"] == "Vision Best"  # owned keys updated
    assert diff["removed"] == ["stale-model"]
    assert diff["updated"] == ["vision-best"]

    # round-trip through a real file: comments survive a load→dump→load cycle
    path.write_text(text, encoding="utf-8")
    again = omp.load_yaml_rt(path)
    assert "top comment" in omp.dump_yaml_rt(again)


def test_models_yaml_no_prune_keeps_unselected(tmp_path: Path) -> None:
    data = omp.CommentedMap()
    omp.update_models_yaml(data, [ENTRY, ENTRY2], BASE, KEY, prune_unselected=False)
    updated, diff = omp.update_models_yaml(data, [ENTRY], BASE, KEY, prune_unselected=False)
    ids = [m["id"] for m in updated["providers"]["stitch"]["models"]]
    assert "text-fast" in ids  # not pruned
    assert diff["removed"] == []


# ── config.yml ──────────────────────────────────────────────────────────────


def test_config_roles_update_only_requested() -> None:
    data = omp.CommentedMap()
    data["modelRoles"] = omp.CommentedMap({"default": "other/model:high", "plan": "stitch/old"})
    updated, warnings, errors = omp.update_config_yaml(
        data,
        roles=[{"role": "default", "model": "vision-best", "effort": "medium"}],
        selected_ids=["vision-best"],
        pruned_ids=["old"],
        ensure_enabled=False,
    )
    assert updated["modelRoles"]["default"] == "stitch/vision-best:medium"
    assert updated["modelRoles"]["plan"] == "stitch/old"  # not in request — untouched
    assert any("dangling" in w for w in warnings)  # plan -> pruned 'old'
    assert not errors


def test_config_role_no_effort_suffix_unless_chosen() -> None:
    data = omp.CommentedMap()
    data["modelRoles"] = omp.CommentedMap()
    updated, _, errors = omp.update_config_yaml(
        data,
        roles=[{"role": "default", "model": "vision-best"}],
        selected_ids=["vision-best"],
        pruned_ids=[],
        ensure_enabled=False,
    )
    assert updated["modelRoles"]["default"] == "stitch/vision-best"
    assert not errors


def test_config_role_invalid_effort_rejected() -> None:
    data = omp.CommentedMap()
    data["modelRoles"] = omp.CommentedMap()
    _, _, errors = omp.update_config_yaml(
        data,
        roles=[{"role": "default", "model": "vision-best", "effort": "ultra"}],
        selected_ids=["vision-best"],
        pruned_ids=[],
        ensure_enabled=False,
    )
    assert errors


@pytest.mark.parametrize("effort", list(omp.EFFORTS))
def test_config_role_valid_efforts(effort: str) -> None:
    data = omp.CommentedMap()
    data["modelRoles"] = omp.CommentedMap()
    updated, _, errors = omp.update_config_yaml(
        data,
        roles=[{"role": "r", "model": "vision-best", "effort": effort}],
        selected_ids=["vision-best"],
        pruned_ids=[],
        ensure_enabled=False,
    )
    assert updated["modelRoles"]["r"] == f"stitch/vision-best:{effort}"
    assert not errors


def test_config_disabled_providers_stitch_removed() -> None:
    data = omp.CommentedMap()
    data["disabledProviders"] = ["stitch", "other"]
    updated, warnings, _ = omp.update_config_yaml(
        data, roles=[], selected_ids=[], pruned_ids=[], ensure_enabled=False
    )
    assert updated["disabledProviders"] == ["other"]
    assert any("disabledProviders" in w for w in warnings)


def test_config_enabled_models_add_only_when_exists() -> None:
    # key absent → never created
    data = omp.CommentedMap()
    updated, _, _ = omp.update_config_yaml(
        data, roles=[], selected_ids=["vision-best"], pruned_ids=[], ensure_enabled=True
    )
    assert "enabledModels" not in updated

    # key present + ensureEnabled → stitch ids appended, others preserved
    data2 = omp.CommentedMap()
    data2["enabledModels"] = ["other/x", "stitch/vision-best"]
    updated2, _, _ = omp.update_config_yaml(
        data2,
        roles=[],
        selected_ids=["vision-best", "text-fast"],
        pruned_ids=[],
        ensure_enabled=True,
    )
    assert updated2["enabledModels"] == ["other/x", "stitch/vision-best", "stitch/text-fast"]

    # key present but ensureEnabled off → untouched
    data3 = omp.CommentedMap()
    data3["enabledModels"] = ["other/x"]
    updated3, _, _ = omp.update_config_yaml(
        data3, roles=[], selected_ids=["vision-best"], pruned_ids=[], ensure_enabled=False
    )
    assert updated3["enabledModels"] == ["other/x"]


def test_config_fallback_chain_pruning_and_self_reference() -> None:
    data = omp.CommentedMap()
    data["retry"] = omp.CommentedMap()
    data["retry"]["fallbackChains"] = omp.CommentedMap({
        "default": ["stitch/old", "other/x", "stitch/vision-best"],
        "stitch/old": ["other/y"],
        "stitch/vision-best": ["stitch/vision-best", "other/z"],
    })
    updated, warnings, _ = omp.update_config_yaml(
        data, roles=[], selected_ids=["vision-best"], pruned_ids=["old"], ensure_enabled=False
    )
    chains = updated["retry"]["fallbackChains"]
    assert chains["default"] == ["other/x", "stitch/vision-best"]
    assert "stitch/old" not in chains  # chain key dropped with its primary
    assert chains["stitch/vision-best"] == ["other/z"]  # self-reference removed
    assert any("self-reference" in w for w in warnings)


# ── path resolution / profiles ──────────────────────────────────────────────


def test_pi_config_dir_renames_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PI_CONFIG_DIR", str(tmp_path / "custom-omp"))
    monkeypatch.delenv("PI_CODING_AGENT_DIR", raising=False)
    assert omp.omp_root() == tmp_path / "custom-omp"
    assert omp.default_agent_dir() == tmp_path / "custom-omp" / "agent"


def test_pi_coding_agent_dir_overrides(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PI_CONFIG_DIR", str(tmp_path / "root"))
    monkeypatch.setenv("PI_CODING_AGENT_DIR", str(tmp_path / "elsewhere"))
    assert omp.default_agent_dir() == tmp_path / "elsewhere"


def test_yaml_fallback_variant(tmp_path: Path) -> None:
    agent = tmp_path / "agent"
    agent.mkdir()
    (agent / "models.yaml").write_text("providers: {}\n", encoding="utf-8")
    profile = omp.make_profile("default", agent, is_default=True)
    assert profile.models_path.name == "models.yaml"  # updated in place
    assert profile.config_path.name == "config.yml"  # absent → .yml


def test_discover_profiles(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PI_CONFIG_DIR", str(tmp_path))
    monkeypatch.delenv("PI_CODING_AGENT_DIR", raising=False)
    named = tmp_path / "profiles" / "work" / "agent"
    named.mkdir(parents=True)
    profiles = omp.discover_profiles()
    names = [p.name for p in profiles]
    assert "default" in names
    assert "work" in names
    work = next(p for p in profiles if p.name == "work")
    assert work.agent_dir == named


def test_profile_hint_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMP_PROFILE", "work")
    assert omp.profile_hint() == "work"
    monkeypatch.delenv("OMP_PROFILE")
    monkeypatch.setenv("PI_PROFILE", "piwork")
    assert omp.profile_hint() == "piwork"


def test_resolve_unknown_named_profile(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PI_CONFIG_DIR", str(tmp_path))
    monkeypatch.delenv("PI_CODING_AGENT_DIR", raising=False)
    profile = omp.resolve_profile("newprof")
    assert profile.name == "newprof"
    assert profile.agent_dir == tmp_path / "profiles" / "newprof" / "agent"
