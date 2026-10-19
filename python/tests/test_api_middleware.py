from stitch_backend.api.middleware import _is_noisy


def test_noisy_paths_and_plugin_poll_convention() -> None:
    assert _is_noisy("/api/get_scheduler_status")
    assert _is_noisy("/api/plugin.stitch-devbox.poll")
    assert _is_noisy("/api/plugin.any-id.poll")
    assert not _is_noisy("/api/plugin.stitch-devbox.agent_prompt")
    assert not _is_noisy("/api/accounts")
