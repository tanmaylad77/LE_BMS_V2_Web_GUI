from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import serial
import serial.tools.list_ports

from .profiles import CENTRAL_V2_PROFILE

LineCallback = Callable[[str], Awaitable[None]]
StatusCallback = Callable[[bool, str | None], Awaitable[None]]


@dataclass(frozen=True)
class SerialPortInfo:
    device: str
    description: str
    hwid: str


def list_serial_ports() -> list[SerialPortInfo]:
    return [
        SerialPortInfo(device=port.device, description=port.description, hwid=port.hwid)
        for port in serial.tools.list_ports.comports()
    ]


class SerialTransport:
    def __init__(
        self,
        on_line: LineCallback,
        on_status: StatusCallback,
        baudrate: int = CENTRAL_V2_PROFILE.baudrate,
    ) -> None:
        self.on_line = on_line
        self.on_status = on_status
        self.baudrate = baudrate
        self.port: str | None = None
        self._serial: serial.Serial | None = None
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()
        self._write_lock = asyncio.Lock()

    @property
    def connected(self) -> bool:
        return self._serial is not None and self._serial.is_open

    async def connect(self, port: str) -> None:
        await self.disconnect()
        self.port = port
        self._stop_event = asyncio.Event()
        self._task = asyncio.create_task(self._reader_loop())

    async def disconnect(self) -> None:
        self._stop_event.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        await self._close_serial()
        await self.on_status(False, None)

    async def write(self, data: bytes) -> None:
        async with self._write_lock:
            if not self.connected or self._serial is None:
                raise RuntimeError("Serial port is not connected.")
            await asyncio.to_thread(self._serial.write, data)
            await asyncio.to_thread(self._serial.flush)

    async def _reader_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                if self._serial is None or not self._serial.is_open:
                    await self._open_serial()
                    await self.on_status(True, None)

                line = await asyncio.to_thread(self._serial.readline)
                if not line:
                    continue
                decoded = line.decode("utf-8", errors="replace").strip()
                if decoded:
                    await self.on_line(decoded)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                await self._close_serial()
                await self.on_status(False, str(exc))
                await asyncio.sleep(1.0)

    async def _open_serial(self) -> None:
        if not self.port:
            raise RuntimeError("No serial port selected.")
        self._serial = await asyncio.to_thread(
            serial.Serial,
            self.port,
            self.baudrate,
            timeout=0.2,
            write_timeout=0.5,
        )

    async def _close_serial(self) -> None:
        serial_obj = self._serial
        self._serial = None
        if serial_obj and serial_obj.is_open:
            await asyncio.to_thread(serial_obj.close)
