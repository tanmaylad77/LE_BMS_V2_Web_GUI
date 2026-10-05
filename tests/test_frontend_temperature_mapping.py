from pathlib import Path
import re


APP_JS = Path("server/static/app.js").read_text()


def test_heatmap_uses_16_display_rows_with_24_value_firmware_stride():
    assert "const rows = 16;" in APP_JS
    assert "temps.length >= cols * 24 ? 24 : rows" in APP_JS


def test_heatmap_index_function_keeps_node_2_out_of_node_3():
    match = re.search(r"function heatmapTempIndex\(stack, sensor, sourceStride\) \{\s*return ([^;]+);", APP_JS)
    assert match
    assert match.group(1).strip() == "stack * sourceStride + sensor"

    def heatmap_temp_index(stack, sensor, source_stride):
        return stack * source_stride + sensor

    assert heatmap_temp_index(1, 0, 24) == 24
    assert heatmap_temp_index(1, 15, 24) == 39
    assert heatmap_temp_index(2, 0, 24) == 48
