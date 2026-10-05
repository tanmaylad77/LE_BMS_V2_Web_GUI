from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ParsedLine:
    raw: str
    level: str
    key: str | None = None
    value: Any = None


def _parse_int(value: str) -> int | str:
    try:
        return int(value)
    except ValueError:
        return value


def _parse_float(value: str) -> float | str:
    try:
        return float(value)
    except ValueError:
        return value


def _parse_csv(value: str, converter=_parse_int) -> list[Any]:
    if value == "":
        return []
    return [converter(part.strip()) for part in value.split(",")]


def _parse_boot(value: str) -> dict[str, int | str]:
    parts = value.split(",")
    boot: dict[str, int | str] = {"count": _parse_int(parts[0]) if parts else ""}
    for part in parts[1:]:
        if "=" not in part:
            continue
        name, raw_value = part.split("=", 1)
        boot[name.strip()] = _parse_int(raw_value.strip())
    return boot


def _parse_bcap(value: str) -> dict[str, Any]:
    if value in {"START", "STOP"}:
        return {"event": value.lower()}

    parts = _parse_csv(value)
    if len(parts) == 3:
        return {"active": bool(parts[0]), "captured_count": parts[1], "live_count": parts[2]}
    if len(parts) == 2:
        return {"captured_count": parts[0], "last_dropped_address": parts[1]}
    return {"raw": value}


def _parse_bord(value: str) -> list[int | None]:
    order: list[int | None] = []
    for part in value.split(","):
        part = part.strip()
        order.append(None if part in {"", "-"} else int(part))
    return order


def _parse_bdbg(value: str) -> dict[str, Any]:
    debug: dict[str, Any] = {}
    for part in value.split(","):
        if "=" in part:
            name, raw_value = part.split("=", 1)
        elif ":" in part:
            name, raw_value = part.split(":", 1)
        else:
            continue

        name = name.strip()
        raw_value = raw_value.strip()
        if name == "live":
            debug[name] = [] if raw_value in {"", "-"} else [int(item) for item in raw_value.split("|")]
        else:
            debug[name] = _parse_int(raw_value)
    return debug


def parse_telemetry_line(line: str) -> ParsedLine:
    raw = line.strip()
    if not raw:
        return ParsedLine(raw=line, level="empty")

    if raw.startswith("ER+"):
        key, _, value = raw[3:].partition("=")
        return ParsedLine(raw=raw, level="error", key=key or None, value=value)

    if raw.startswith("WARN"):
        return ParsedLine(raw=raw, level="warning", value=raw)

    if not raw.startswith("OK+"):
        return ParsedLine(raw=raw, level="text", value=raw)

    payload = raw[3:]
    key, separator, value = payload.partition("=")
    if not separator:
        return ParsedLine(raw=raw, level="ok", key=key, value=True)

    key = key.strip().upper()
    value = value.strip()

    if key == "BOOT":
        parsed_value = _parse_boot(value)
    elif key == "INFO":
        parsed_value = value
    elif key in {"ISHN"}:
        parsed_value = [item / 100.0 if isinstance(item, int) else item for item in _parse_csv(value)]
    elif key == "TEMP":
        parsed_value = [item / 10.0 if isinstance(item, int) else item for item in _parse_csv(value)]
    elif key in {"VCEL"}:
        parsed_value = _parse_csv(value)
    elif key in {"VPCK", "IPCK"}:
        parsed_value = _parse_float(value)
        if isinstance(parsed_value, float):
            parsed_value /= 100.0
    elif key in {"VCLV", "VCHV"}:
        parsed_value = _parse_float(value)
        if isinstance(parsed_value, float):
            parsed_value /= 1000.0
    elif key == "PSOC":
        parsed_value = _parse_float(value)
        if isinstance(parsed_value, float):
            parsed_value /= 100.0
    elif key == "RCAP":
        parsed_value = _parse_float(value)
        if isinstance(parsed_value, float):
            parsed_value /= 100.0
    elif key in {"VLCK", "TLCK", "ICLK", "SVAL"}:
        parsed_value = bool(int(value))
    elif key == "STAT":
        status = {0: "Idle", 1: "Charging", 2: "Discharging"}
        parsed_value = status.get(int(value), value) if value.isdigit() else value
    elif key == "BCAP":
        parsed_value = _parse_bcap(value)
    elif key == "BORD":
        parsed_value = _parse_bord(value)
    elif key == "BDBG":
        parsed_value = _parse_bdbg(value)
    elif "," in value:
        parsed_value = _parse_csv(value)
    else:
        parsed_value = _parse_int(value)

    return ParsedLine(raw=raw, level="ok", key=key, value=parsed_value)
