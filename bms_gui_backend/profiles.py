from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FirmwareProfile:
    name: str
    baudrate: int
    cell_count: int
    shunt_count: int
    telemetry_keys: tuple[str, ...]
    allowed_commands: tuple[str, ...]


CENTRAL_V2_TELEMETRY_KEYS = (
    "BOOT",
    "INFO",
    "ISHN",
    "VPCK",
    "IPCK",
    "WPCK",
    "VCLV",
    "VCHV",
    "VCLN",
    "VCHN",
    "PSOC",
    "PSOH",
    "RCAP",
    "SVAL",
    "ICLK",
    "TCHT",
    "TCLT",
    "TCHN",
    "TCLN",
    "DCLA",
    "CCLA",
    "VLCK",
    "TLCK",
    "STAT",
    "VCEL",
    "BCAP",
    "BORD",
    "BDBG",
    "TEMP",
)


CENTRAL_V2_ALLOWED_COMMANDS = (
    "SET+BCAP=1",
    "SET+BCAP=0",
    "SET+BCLR=1",
    "GET+BCAP",
    "GET+BORD",
    "GET+BDBG",
)


CENTRAL_V2_PROFILE = FirmwareProfile(
    name="LE_BMS_A_V2_Central",
    baudrate=115200,
    cell_count=16,
    shunt_count=8,
    telemetry_keys=CENTRAL_V2_TELEMETRY_KEYS,
    allowed_commands=CENTRAL_V2_ALLOWED_COMMANDS,
)
