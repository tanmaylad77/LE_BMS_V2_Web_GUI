from __future__ import annotations

from dataclasses import dataclass

from .profiles import CENTRAL_V2_ALLOWED_COMMANDS


class CommandError(ValueError):
    pass


@dataclass(frozen=True)
class SerialCommand:
    text: str

    def wire_text(self) -> bytes:
        return f"{self.text}\r\n".encode("utf-8")


def normalize_command(text: str) -> SerialCommand:
    command = text.strip().upper()
    if not command:
        raise CommandError("Command is empty.")

    if command not in CENTRAL_V2_ALLOWED_COMMANDS:
        allowed = ", ".join(CENTRAL_V2_ALLOWED_COMMANDS)
        raise CommandError(f"Unsupported Central V2 command. Allowed: {allowed}")

    return SerialCommand(command)


def b_node_command(action: str) -> SerialCommand:
    commands = {
        "start_capture": "SET+BCAP=1",
        "stop_capture": "SET+BCAP=0",
        "clear_order": "SET+BCLR=1",
        "get_capture": "GET+BCAP",
        "get_order": "GET+BORD",
        "get_debug": "GET+BDBG",
    }
    try:
        return SerialCommand(commands[action])
    except KeyError as exc:
        raise CommandError(f"Unknown B-node action: {action}") from exc

