"""opencode_config domain — read/write of opencode.json and omo.jsonc.

Pure file layer (no DB, no network): normalizes both config stores, upserts
providers, and assigns agent models to the store that wins for the agent.
"""
