"""Pydantic request schemas for the key_health domain commands.

Per the project's type-validation convention, incoming params are validated
through Pydantic models with ``populate_by_name=True`` and aliases so both
camelCase (frontend-native) and snake_case keys are accepted on the way in.
The dispatcher handles camelCase conversion automatically on the way out.
"""
