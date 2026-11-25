"""oh-my-pi (omp) config writer — models.yml + config.yml with ruamel round-trip.

YAML is loaded/dumped with ``ruamel.yaml`` round-trip mode so existing
comments and key order survive a rewrite.

Path resolution:
- ``PI_CONFIG_DIR`` renames the ``.omp`` root (default ``~/.omp``)
- ``PI_CODING_AGENT_DIR`` overrides the whole agent dir of the DEFAULT profile
- named profiles live in ``<root>/profiles/<name>/agent``
- ``OMP_PROFILE`` / ``PI_PROFILE`` are initial selection hints only
- ``.yaml`` fallback: when ``models.yaml`` exists it is updated in place,
  otherwise ``models.yml`` is written (same for ``config``)
"""

from __future__ import annotations

import copy
import io
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

STITCH_PROVIDER_ID = "stitch"
OMP_API = "openai-completions"
CONTEXT_FALLBACK = 128000
MAX_TOKENS_FALLBACK = 16384
MAX_TOKENS_CAP = 32768
EFFORTS = ("off", "minimal", "low", "medium", "high", "xhigh", "max")


def _yaml() -> YAML:
    yaml = YAML(typ="rt")
    yaml.preserve_quotes = True
    yaml.width = 4096  # avoid ruamel re-wrapping long lines
    return yaml


def load_yaml_rt(path: Path) -> Any:
    """Round-trip load; returns a CommentedMap (empty when file missing)."""
    yaml = _yaml()
    if not path.exists():
        return CommentedMap()
    data = yaml.load(path.read_text(encoding="utf-8"))
    if data is None:
        return CommentedMap()
    if not isinstance(data, dict):
        raise ValueError(f"yaml root is not a mapping: {path}")
    return data


def dump_yaml_rt(data: Any) -> str:
    yaml = _yaml()
    stream = io.StringIO()
    yaml.dump(data, stream)
    return stream.getvalue()


def omp_root() -> Path:
    override = os.environ.get("PI_CONFIG_DIR")
    if override:
        return Path(override)
    return Path.home() / ".omp"


def default_agent_dir() -> Path:
    override = os.environ.get("PI_CODING_AGENT_DIR")
    if override:
        return Path(override)
    return omp_root() / "agent"


def _yaml_variant(agent_dir: Path, stem: str) -> Path:
    """Prefer the existing ``.yaml`` variant in place; otherwise ``.yml``."""
    legacy = agent_dir / f"{stem}.yaml"
    if legacy.exists():
        return legacy
    return agent_dir / f"{stem}.yml"


@dataclass
class OmpProfile:
    name: str
    agent_dir: Path
    models_path: Path
    config_path: Path
    is_default: bool = False
    warnings: list[str] = field(default_factory=list)

    @property
    def exists(self) -> bool:
        return self.agent_dir.exists()


def make_profile(name: str, agent_dir: Path, *, is_default: bool = False) -> OmpProfile:
    return OmpProfile(
        name=name,
        agent_dir=agent_dir,
        models_path=_yaml_variant(agent_dir, "models"),
        config_path=_yaml_variant(agent_dir, "config"),
        is_default=is_default,
    )


def discover_profiles(root: Path | None = None) -> list[OmpProfile]:
    """All visible profiles: the default plus every ``profiles/<name>``."""
    root = root or omp_root()
    profiles = [make_profile("default", default_agent_dir(), is_default=True)]
    profiles_dir = root / "profiles"
    if profiles_dir.is_dir():
        for child in sorted(profiles_dir.iterdir()):
            if child.is_dir():
                profiles.append(make_profile(child.name, child / "agent"))
    return profiles


def profile_hint() -> str | None:
    return os.environ.get("OMP_PROFILE") or os.environ.get("PI_PROFILE")


def resolve_profile(name: str | None = None, root: Path | None = None) -> OmpProfile:
    """Resolve a profile by name; falls back to the env hint, then default."""
    wanted = name or profile_hint() or "default"
    for profile in discover_profiles(root):
        if profile.name == wanted:
            return profile
    # unknown named profile: treat as a not-yet-existing named profile dir
    if wanted != "default":
        base = (root or omp_root()) / "profiles" / wanted / "agent"
        return make_profile(wanted, base)
    return make_profile("default", default_agent_dir(), is_default=True)


def build_omp_model_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """Native omp model shape for the stitch provider."""
    input_modalities = list(entry.get("inputModalities") or ["text"])
    omp_input = [m for m in input_modalities if m in ("text", "image")]
    if "text" not in omp_input:
        omp_input.insert(0, "text")
    context = entry.get("contextTokens") or CONTEXT_FALLBACK
    if entry.get("outputTokensExplicit"):
        max_tokens = int(entry["outputTokens"])
    else:
        max_tokens = MAX_TOKENS_FALLBACK
    max_tokens = min(max_tokens, MAX_TOKENS_CAP)
    out: dict[str, Any] = {
        "id": entry["id"],
        "name": entry["name"],
        "input": omp_input,
        "contextWindow": context,
        "maxTokens": max_tokens,
    }
    if entry.get("tools", True):
        out["supportsTools"] = True
    if entry.get("reasoning") is not None:
        out["reasoning"] = bool(entry["reasoning"])
    return out


def update_models_yaml(
    data: Any,
    entries: list[dict[str, Any]],
    base_url: str,
    api_key: str,
    *,
    prune_unselected: bool,
) -> tuple[Any, dict[str, list[str]]]:
    """Merge the stitch provider into a round-trip-loaded models.yml mapping.

    Unknown provider-level keys and unknown keys of surviving model entries
    are preserved.  Unselected stitch models are pruned only when
    ``prune_unselected`` — otherwise they survive untouched.

    NOTE: ``apiKey`` is the literal gateway token (status-quo behaviour — omp
    resolves ``!cmd`` prefixes / env var names / literals; a literal token is
    what the legacy tooling always wrote).
    """
    selected_ids = [e["id"] for e in entries]
    selected_set = set(selected_ids)
    diff: dict[str, list[str]] = {"added": [], "removed": [], "updated": [], "unchanged": []}

    providers = data.get("providers")
    if not isinstance(providers, dict):
        providers = CommentedMap()
        data["providers"] = providers

    existing = providers.get(STITCH_PROVIDER_ID)
    existing = existing if isinstance(existing, dict) else CommentedMap()
    existing_models = existing.get("models")
    existing_models = list(existing_models) if isinstance(existing_models, list) else []
    by_id = {m.get("id"): m for m in existing_models if isinstance(m, dict) and m.get("id")}

    # provider-level: preserve unrelated keys, overwrite the ones we own
    provider = copy.deepcopy(existing) if not isinstance(existing, CommentedMap) else existing
    provider["baseUrl"] = base_url
    provider["api"] = OMP_API
    provider["apiKey"] = api_key
    provider["authHeader"] = True
    provider["auth"] = "apiKey"

    new_list = CommentedSeq()
    seen: set[str] = set()
    # keep existing order for surviving entries, then append new ones
    ordered_entries = sorted(
        entries,
        key=lambda e: (
            list(by_id).index(e["id"]) if e["id"] in by_id else len(by_id),
            selected_ids.index(e["id"]),
        ),
    )
    for entry in ordered_entries:
        model_id = str(entry["id"])
        generated = build_omp_model_entry(entry)
        old = by_id.get(model_id)
        if isinstance(old, dict):
            merged = copy.deepcopy(old)
            if generated != {k: merged.get(k) for k in generated}:
                diff["updated"].append(model_id)
            else:
                diff["unchanged"].append(model_id)
            merged.update(generated)
            new_list.append(merged)
        else:
            diff["added"].append(model_id)
            new_list.append(generated)
        seen.add(model_id)

    if not prune_unselected:
        for model in existing_models:
            if isinstance(model, dict) and model.get("id") and model["id"] not in seen:
                new_list.append(model)
                seen.add(model["id"])
    else:
        for old_id in by_id:
            if old_id not in selected_set:
                diff["removed"].append(str(old_id))

    provider["models"] = new_list
    providers[STITCH_PROVIDER_ID] = provider
    return data, diff


def validate_effort(effort: str) -> bool:
    return effort in EFFORTS


def update_config_yaml(
    data: Any,
    *,
    roles: list[dict[str, Any]] | None,
    selected_ids: list[str],
    pruned_ids: list[str],
    ensure_enabled: bool,
) -> tuple[Any, list[str], list[str]]:
    """Merge stitch-related config.yml updates.

    Returns ``(data, warnings, errors)``:

    - ``modelRoles`` updates ONLY for roles passed in the request; selector
      ``stitch/<id>`` with ``:effort`` suffix only when explicitly chosen.
      Roles not in the request are never touched.
    - fallback chains never include their primary; pruned stitch models are
      removed from chains (chain keys that ARE pruned stitch models drop out).
    - existing stitch roles pointing at pruned models produce warnings
      (caller decides warning vs block).
    - ``stitch`` is removed from ``disabledProviders``.
    - ``enabledModels``: stitch ids are added ONLY when the key already
      exists and ``ensure_enabled`` — the key is never created.
    """
    warnings: list[str] = []
    errors: list[str] = []
    pruned_set = set(pruned_ids)
    selected_set = set(selected_ids)

    roles = roles or []
    model_roles = data.get("modelRoles")
    if not isinstance(model_roles, dict):
        model_roles = CommentedMap()
        if roles:
            data["modelRoles"] = model_roles

    for update in roles:
        role = update.get("role")
        model = update.get("model")
        effort = update.get("effort")
        if not role or not model:
            errors.append("role update requires both 'role' and 'model'")
            continue
        if model not in selected_set:
            errors.append(f"role {role}: model '{model}' is not in the selected set")
            continue
        selector = f"{STITCH_PROVIDER_ID}/{model}"
        if effort:
            if not validate_effort(str(effort)):
                errors.append(f"role {role}: invalid effort '{effort}'")
                continue
            selector = f"{selector}:{effort}"
        current = model_roles.get(role)
        if isinstance(current, str) and not current.startswith(f"{STITCH_PROVIDER_ID}/"):
            warnings.append(f"role {role}: overriding non-stitch selector '{current}'")
        model_roles[role] = selector

    # dangling roles: stitch roles pointing at pruned models
    for role, value in model_roles.items():
        if not isinstance(value, str):
            continue
        head = value.split(":", 1)[0]
        if head.startswith(f"{STITCH_PROVIDER_ID}/"):
            model_id = head[len(STITCH_PROVIDER_ID) + 1 :]
            if model_id in pruned_set:
                warnings.append(
                    f"role {role} -> {value} points at pruned model '{model_id}' (dangling)"
                )

    # fallback chains: drop pruned stitch models; a chain never contains its primary
    retry = data.get("retry")
    if isinstance(retry, dict):
        chains = retry.get("fallbackChains")
        if isinstance(chains, dict):
            drop_keys: list[str] = []
            for key, values in list(chains.items()):
                if (
                    isinstance(key, str)
                    and key.startswith(f"{STITCH_PROVIDER_ID}/")
                    and key[len(STITCH_PROVIDER_ID) + 1 :] in pruned_set
                ):
                    drop_keys.append(key)
                    continue
                if isinstance(values, list):
                    cleaned = []
                    for value in values:
                        if not isinstance(value, str):
                            cleaned.append(value)
                            continue
                        if value == key:
                            warnings.append(f"fallback chain {key}: removed self-reference")
                            continue
                        if value.startswith(f"{STITCH_PROVIDER_ID}/") and (
                            value[len(STITCH_PROVIDER_ID) + 1 :] in pruned_set
                        ):
                            warnings.append(f"fallback chain {key}: removed pruned {value}")
                            continue
                        cleaned.append(value)
                    chains[key] = cleaned
            for key in drop_keys:
                warnings.append(f"fallback chain {key}: dropped (primary pruned)")
                del chains[key]

    disabled = data.get("disabledProviders")
    if isinstance(disabled, list) and STITCH_PROVIDER_ID in disabled:
        while STITCH_PROVIDER_ID in disabled:
            disabled.remove(STITCH_PROVIDER_ID)
        warnings.append("removed stitch from disabledProviders")

    enabled_models = data.get("enabledModels")
    if isinstance(enabled_models, list) and ensure_enabled:
        for model_id in selected_ids:
            selector = f"{STITCH_PROVIDER_ID}/{model_id}"
            if selector not in enabled_models:
                enabled_models.append(selector)

    return data, warnings, errors


def existing_stitch_model_ids_omp(data: Any) -> set[str]:
    providers = data.get("providers") if isinstance(data, dict) else None
    if not isinstance(providers, dict):
        return set()
    stitch = providers.get(STITCH_PROVIDER_ID)
    if not isinstance(stitch, dict):
        return set()
    models = stitch.get("models")
    if not isinstance(models, list):
        return set()
    return {m["id"] for m in models if isinstance(m, dict) and m.get("id")}


def extract_stitch_api_key_omp(data: Any) -> str | None:
    """Return the currently configured stitch ``apiKey`` from models.yml.

    This is internal key material: callers may hash/compare it and use it for
    a rewrite, but must never include it in responses, logs or diffs.
    """
    providers = data.get("providers") if isinstance(data, dict) else None
    if not isinstance(providers, dict):
        return None
    stitch = providers.get(STITCH_PROVIDER_ID)
    if not isinstance(stitch, dict):
        return None
    value = stitch.get("apiKey")
    return value if isinstance(value, str) and value else None
