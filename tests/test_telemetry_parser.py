from bms_gui_backend.commands import CommandError, normalize_command
from bms_gui_backend.state import BmsState
from bms_gui_backend.telemetry_parser import parse_telemetry_line


def test_scaled_pack_values():
    assert parse_telemetry_line("OK+VPCK=5321").value == 53.21
    assert parse_telemetry_line("OK+IPCK=-123").value == -1.23
    assert parse_telemetry_line("OK+PSOC=6250").value == 62.5
    assert parse_telemetry_line("OK+RCAP=1245").value == 12.45


def test_b_node_capture_status():
    parsed = parse_telemetry_line("OK+BCAP=1,4,12")
    assert parsed.key == "BCAP"
    assert parsed.value == {"active": True, "captured_count": 4, "live_count": 12}


def test_b_node_capture_event():
    assert parse_telemetry_line("OK+BCAP=START").value == {"event": "start"}


def test_b_node_order():
    parsed = parse_telemetry_line("OK+BORD=2,4,-,8")
    assert parsed.value == [2, 4, None, 8]


def test_b_node_debug():
    parsed = parse_telemetry_line("OK+BDBG=live:1|3|5,temp=10,volt=12,vvalid=11,vunk=1,vinv=0")
    assert parsed.value["live"] == [1, 3, 5]
    assert parsed.value["temp"] == 10
    assert parsed.value["volt"] == 12
    assert parsed.value["vvalid"] == 11
    assert parsed.value["vunk"] == 1
    assert parsed.value["vinv"] == 0


def test_temperature_values_are_degrees_c():
    parsed = parse_telemetry_line("OK+TEMP=201,205,0,-35")
    assert parsed.value == [20.1, 20.5, 0.0, -3.5]


def test_state_derives_cells():
    state = BmsState()
    state.apply(parse_telemetry_line("OK+VCEL=3301,0,3299"))
    snapshot = state.snapshot()
    assert len(snapshot["derived"]["cells"]) == 16
    assert snapshot["derived"]["cells"][0]["millivolts"] == 3301
    assert snapshot["derived"]["cells"][1]["zero"] is True
    assert snapshot["derived"]["cells"][3]["missing"] is True
    assert snapshot["derived"]["cell_min"]["index"] == 3


def test_command_allowlist():
    assert normalize_command(" get+bdbg ").text == "GET+BDBG"
    try:
        normalize_command("SET+PSOC=10000")
    except CommandError:
        pass
    else:
        raise AssertionError("Expected CommandError")
