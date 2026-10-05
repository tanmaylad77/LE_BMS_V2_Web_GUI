from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from .profiles import CENTRAL_V2_PROFILE, FirmwareProfile
from .telemetry_parser import ParsedLine


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class CellReading:
    index: int
    millivolts: int | None = None
    stale: bool = True
    missing: bool = True
    zero: bool = False


@dataclass
class ConnectionState:
    connected: bool = False
    port: str | None = None
    baudrate: int = 115200
    error: str | None = None
    last_connected_at: str | None = None
    last_line_at: str | None = None


@dataclass
class BmsState:
    profile: FirmwareProfile = CENTRAL_V2_PROFILE
    connection: ConnectionState = field(default_factory=ConnectionState)
    telemetry: dict[str, Any] = field(default_factory=dict)
    updated_at: dict[str, str] = field(default_factory=dict)
    raw_log: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=250))

    def add_raw_line(self, direction: str, line: str, level: str = "text") -> None:
        at = utc_now_iso()
        self.raw_log.append({"at": at, "direction": direction, "line": line, "level": level})
        if direction == "rx":
            self.connection.last_line_at = at

    def apply(self, parsed: ParsedLine) -> bool:
        if parsed.raw:
            self.add_raw_line("rx", parsed.raw, parsed.level)

        if parsed.level != "ok" or not parsed.key:
            return False

        self.telemetry[parsed.key] = parsed.value
        self.updated_at[parsed.key] = utc_now_iso()
        return True

    def note_tx(self, command: str) -> None:
        self.add_raw_line("tx", command, "command")

    def snapshot(self) -> dict[str, Any]:
        cells = self._cell_snapshot()
        return {
            "profile": {
                "name": self.profile.name,
                "baudrate": self.profile.baudrate,
                "cell_count": self.profile.cell_count,
            },
            "connection": self.connection.__dict__,
            "telemetry": self.telemetry,
            "updated_at": self.updated_at,
            "derived": {
                "cells": cells,
                "cell_min": self._cell_extreme(cells, min),
                "cell_max": self._cell_extreme(cells, max),
                "b_node": self._b_node_snapshot(),
            },
            "raw_log": list(self.raw_log),
        }

    def _cell_snapshot(self) -> list[dict[str, Any]]:
        values = self.telemetry.get("VCEL")
        if not isinstance(values, list):
            values = []

        result = []
        for idx in range(self.profile.cell_count):
            value = values[idx] if idx < len(values) else None
            missing = value is None
            zero = value == 0
            stale = missing or zero
            result.append(
                CellReading(
                    index=idx + 1,
                    millivolts=value if isinstance(value, int) else None,
                    stale=stale,
                    missing=missing,
                    zero=zero,
                ).__dict__
            )
        return result

    @staticmethod
    def _cell_extreme(cells: list[dict[str, Any]], chooser) -> dict[str, Any] | None:
        valid = [cell for cell in cells if isinstance(cell["millivolts"], int) and cell["millivolts"] > 0]
        if not valid:
            return None
        return chooser(valid, key=lambda cell: cell["millivolts"])

    def _b_node_snapshot(self) -> dict[str, Any]:
        capture = self.telemetry.get("BCAP")
        order = self.telemetry.get("BORD")
        debug = self.telemetry.get("BDBG")
        return {
            "capture": capture if isinstance(capture, dict) else {},
            "order": order if isinstance(order, list) else [],
            "debug": debug if isinstance(debug, dict) else {},
        }

