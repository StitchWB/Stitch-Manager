"""Community domain — friends directory + AiApiRadar offers/stats proxy.

Stateless: no DB tables.  Friends are loaded from a bundled JSON file;
radar offers/stats are proxied from the AiApiRadar API with a short
in-memory TTL cache.
"""
