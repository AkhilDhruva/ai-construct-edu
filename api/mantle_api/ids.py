import os
import time

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def ulid(ms: int | None = None) -> str:
    """26-char ULID: 48-bit millisecond time + 80 random bits, Crockford base32.
    Same format the browser mints, so server-made rows sort with client-made ones."""
    t = int(time.time() * 1000) if ms is None else ms
    value = (t << 80) | int.from_bytes(os.urandom(10), "big")
    out = []
    for _ in range(26):
        out.append(_CROCKFORD[value & 31])
        value >>= 5
    return "".join(reversed(out))
