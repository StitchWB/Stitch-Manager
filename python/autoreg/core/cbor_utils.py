"""
CBOR encoding/decoding utilities.

CBOR (Compact Binary Object Representation) - бинарный формат данных,
используемый AWS Smithy RPC v2 protocol.
"""

from typing import Any

import cbor2


def cbor_encode(data: dict[str, Any] | list) -> bytes:
    """
    Кодирует Python dict/list в CBOR bytes.

    Args:
        data: Словарь или список для кодирования

    Returns:
        CBOR encoded bytes

    Raises:
        ValueError: Если кодирование не удалось

    Example:
        >>> cbor_encode({'name': 'John', 'age': 30})
        b'\\xa2dnamedjohncage\\x18\\x1e'
    """
    try:
        return cbor2.dumps(data)
    except Exception as e:
        raise ValueError(f"CBOR encode failed: {e}") from e


def cbor_decode(data: bytes) -> dict[str, Any] | list:
    """
    Декодирует CBOR bytes в Python dict/list.

    Args:
        data: CBOR encoded bytes

    Returns:
        Декодированный словарь или список

    Raises:
        ValueError: Если декодирование не удалось

    Example:
        >>> cbor_decode(b'\\xa2dnamedjohncage\\x18\\x1e')
        {'name': 'John', 'age': 30}
    """
    try:
        result: dict[str, Any] | list = cbor2.loads(data)
        return result
    except Exception as e:
        raise ValueError(f"CBOR decode failed: {e}") from e


def cbor_encode_hex(data: dict[str, Any] | list) -> str:
    """
    Кодирует в CBOR и возвращает hex представление для отладки.

    Args:
        data: Данные для кодирования

    Returns:
        Hex строка (например, "a2 64 6e 61 6d 65 64 4a 6f 68 6e")

    Example:
        >>> cbor_encode_hex({'name': 'John'})
        'a2 64 6e 61 6d 65 64 4a 6f 68 6e'
    """
    encoded = cbor_encode(data)
    return ' '.join(f'{b:02x}' for b in encoded)


def cbor_size_comparison(data: dict[str, Any] | list) -> dict[str, int]:
    """
    Сравнивает размер JSON vs CBOR для отладки.

    Args:
        data: Данные для сравнения

    Returns:
        {'json': int, 'cbor': int, 'savings': int}

    Example:
        >>> cbor_size_comparison({'name': 'John', 'age': 30})
        {'json': 26, 'cbor': 17, 'savings': 9}
    """
    import json

    json_bytes = json.dumps(data).encode()
    cbor_bytes = cbor_encode(data)

    return {
        'json': len(json_bytes),
        'cbor': len(cbor_bytes),
        'savings': len(json_bytes) - len(cbor_bytes)
    }
