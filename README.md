# LE BMS Central V2 Bring-up Web App

Focused local dashboard for `LE_BMS_A_V2_Central` no-BMIC bring-up/configuration. It reads the Central V2 USB serial stream at 115200 baud, parses `OK+KEY=value` telemetry, keeps a reusable Python state model, and serves a browser UI with live updates over WebSocket.

The existing PyQt GUI is not modified. This app only reuses the useful protocol ideas: serial port scanning, CR/LF command writes, line reads, telemetry parsing, and a current BMS state dictionary.

## Setup

```powershell
cd C:\Users\Tanmay_CS\Documents\LE_BMS
python -m venv .venv-web
.\.venv-web\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## Run

```powershell
uvicorn server.main:app --reload --host 127.0.0.1 --port 8000
```

Open:

```text
http://127.0.0.1:8000
```

Use the port selector or manual port input. Central V2 has recently appeared as `COM9`, but the app scans available serial ports.

## Supported Central V2 Commands

The manual command field is intentionally restricted to the B-node ordering commands needed for bring-up:

```text
SET+BCAP=1
SET+BCAP=0
SET+BCLR=1
GET+BCAP
GET+BORD
GET+BDBG
```

The command writer appends `\r\n`, matching the firmware serial parser.

## Displayed Telemetry

The parser handles the Central V2 `OK+KEY=value` fields:

```text
BOOT INFO ISHN VPCK IPCK WPCK VCLV VCHV VCLN VCHN
PSOC PSOH RCAP SVAL ICLK TCHT TCLT TCHN TCLN
DCLA CCLA VLCK TLCK STAT VCEL BCAP BORD BDBG
```

Important scaling:

- `VPCK`, `IPCK`: firmware centi-units, displayed as V/A.
- `PSOC`: firmware hundredths of a percent, displayed as percent.
- `RCAP`: firmware centi-Ah, displayed as Ah.
- `VCLV`, `VCHV`: firmware mV, displayed as V.
- `VCEL`: shown as 16 raw mV values.
- `ISHN`: firmware centi-amps, displayed as amps.

## B-node Telemetry Formats

Current firmware behavior from `LE_BMS_A_V2_Central\lib\CS_BMS\src\CS_BMS.cpp`:

```text
OK+BCAP=active,captured_count,live_count
OK+BCAP=captured_count,last_dropped_address
OK+BCAP=START
OK+BCAP=STOP
OK+BORD=addr_or_dash,... sixteen entries total
OK+BDBG=live:addr|addr,temp=n,volt=n,vvalid=n,vunk=n,vinv=n
```

## Backend Layout

```text
bms_gui_backend/
  serial_transport.py   serial port scan/connect/reconnect/read/write
  telemetry_parser.py   OK+/ER+/WARN line parser
  state.py              current Central V2 state and derived cell/B-node views
  commands.py           allowed command normalization
  profiles.py           Central V2 capability/profile metadata
server/
  main.py               FastAPI REST and WebSocket server
  static/               plain HTML/CSS/JS dashboard
```

## Quick Checks Without Hardware

```powershell
python -m pytest
```

