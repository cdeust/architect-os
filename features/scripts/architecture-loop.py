"""Check the reading order, containment and connectors of the README's hand-drawn loop."""
import re
import sys
import xml.etree.ElementTree as ET

ns = {"s": "http://www.w3.org/2000/svg"}
root = ET.parse(sys.argv[1]).getroot()
loop = root.find(".//s:g[@id='orchestration-loop']", ns)
assert loop is not None, "missing orchestration loop"
names = ["brief", "scouts", "build", "checks", "replay", "reviews", "gate", "delivery"]
phases = loop.findall("s:g", ns)
ids = [phase.attrib["id"] for phase in phases]
assert ids == [f"loop-{name}" for name in names], ids


def bounds(rect):
    x, y, w, h = (float(rect.attrib[key]) for key in ("x", "y", "width", "height"))
    return x, y, x + w, y + h


frames = {}
for phase in phases:
    name = phase.attrib["id"]
    left, top, right, bottom = bounds(phase.find("s:rect", ns))
    frames[name] = (left, top, right, bottom)
    assert phase.find("s:text[@id='" + phase.attrib["aria-labelledby"] + "']", ns) is not None, name
    badges = []
    for node in phase.iter():
        if node.tag == "{" + ns["s"] + "}rect":
            x1, y1, x2, y2 = bounds(node)
            assert left <= x1 < x2 <= right and top <= y1 < y2 <= bottom, (name, node.attrib)
        elif node.tag == "{" + ns["s"] + "}text":
            x, y = (float(node.attrib[key]) for key in ("x", "y"))
            assert left < x < right and top < y < bottom, (name, node.text)
            assert float(node.attrib["font-size"]) * 920 / 1400 >= 11, (name, node.text)
            if node.text in {"ready", "next"}:
                badges.append(node.text)
    assert "ready" in badges and "next" in badges, name

edges = loop.findall("s:path", ns)
assert [(e.get("data-from"), e.get("data-to")) for e in edges] == list(zip(ids, ids[1:]))
for edge in edges:
    src, dst = frames[edge.attrib["data-from"]], frames[edge.attrib["data-to"]]
    path = re.fullmatch(r"M([\d.]+) ([\d.]+) V([\d.]+)", edge.attrib["d"])
    assert path and edge.get("marker-end"), edge.attrib
    x, start, end = map(float, path.groups())
    assert max(src[0], dst[0]) < x < min(src[2], dst[2]), edge.attrib
    assert start == src[3] and start < end <= dst[1] and dst[1] - end <= 3, edge.attrib
assert not loop.findall("s:rect", ns), "unowned cards in the loop"
