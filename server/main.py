from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from bms_gui_backend.commands import CommandError, b_node_command, normalize_command
from bms_gui_backend.profiles import CENTRAL_V2_PROFILE
from bms_gui_backend.serial_transport import SerialTransport, list_serial_ports
from bms_gui_backend.state import BmsState
from bms_gui_backend.telemetry_parser import parse_telemetry_line


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"


class ConnectRequest(BaseModel):
    port: str


class CommandRequest(BaseModel):
    command: str


class BNodeActionRequest(BaseModel):
    action: str


class Hub:
    def __init__(self) -> None:
        self.state = BmsState()
        self.clients: set[WebSocket] = set()
        self.lock = asyncio.Lock()
        self.transport = SerialTransport(
            on_line=self.handle_line,
            on_status=self.handle_status,
            baudrate=CENTRAL_V2_PROFILE.baudrate,
        )

    async def handle_line(self, line: str) -> None:
        parsed = parse_telemetry_line(line)
        async with self.lock:
            self.state.apply(parsed)
        await self.broadcast()

    async def handle_status(self, connected: bool, error: str | None) -> None:
        async with self.lock:
            self.state.connection.connected = connected
            self.state.connection.port = self.transport.port
            self.state.connection.baudrate = self.transport.baudrate
            self.state.connection.error = error
            if connected:
                self.state.connection.last_connected_at = datetime.now(timezone.utc).isoformat()
        await self.broadcast()

    async def snapshot(self) -> dict[str, Any]:
        async with self.lock:
            return self.state.snapshot()

    async def connect(self, port: str) -> None:
        async with self.lock:
            self.state.connection.port = port
            self.state.connection.error = None
        await self.transport.connect(port)

    async def disconnect(self) -> None:
        await self.transport.disconnect()

    async def send_command(self, command_text: str) -> str:
        command = normalize_command(command_text)
        await self.transport.write(command.wire_text())
        async with self.lock:
            self.state.note_tx(command.text)
        await self.broadcast()
        return command.text

    async def send_b_node_action(self, action: str) -> str:
        command = b_node_command(action)
        return await self.send_command(command.text)

    async def register(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.clients.add(websocket)
        await websocket.send_json(await self.snapshot())

    def unregister(self, websocket: WebSocket) -> None:
        self.clients.discard(websocket)

    async def broadcast(self) -> None:
        if not self.clients:
            return
        snapshot = await self.snapshot()
        stale: list[WebSocket] = []
        for client in self.clients:
            try:
                await client.send_json(snapshot)
            except Exception:
                stale.append(client)
        for client in stale:
            self.unregister(client)


hub = Hub()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await hub.disconnect()


app = FastAPI(title="LE BMS Central V2 Bring-up", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/ports")
async def ports() -> dict[str, Any]:
    return {"ports": [port.__dict__ for port in list_serial_ports()]}


@app.get("/api/state")
async def state() -> dict[str, Any]:
    return await hub.snapshot()


@app.post("/api/connect")
async def connect(request: ConnectRequest) -> dict[str, Any]:
    if not request.port.strip():
        raise HTTPException(status_code=400, detail="Port is required.")
    await hub.connect(request.port.strip())
    return await hub.snapshot()


@app.post("/api/disconnect")
async def disconnect() -> dict[str, Any]:
    await hub.disconnect()
    return await hub.snapshot()


@app.post("/api/command")
async def command(request: CommandRequest) -> dict[str, str]:
    try:
        sent = await hub.send_command(request.command)
    except CommandError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"sent": sent}


@app.post("/api/b-node")
async def b_node(request: BNodeActionRequest) -> dict[str, str]:
    try:
        sent = await hub.send_b_node_action(request.action)
    except CommandError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"sent": sent}


@app.websocket("/ws")
async def websocket_state(websocket: WebSocket) -> None:
    await hub.register(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.unregister(websocket)
