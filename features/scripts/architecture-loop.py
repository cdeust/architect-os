"""Check the reading order, containment and connectors of the README's hand-drawn loop."""
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ns = {"s": "http://www.w3.org/2000/svg"}

class StaticDiagram(ET.TreeBuilder):
    def pi(self, target, text):
        raise ValueError("processing instructions are not part of the diagram")

    def doctype(self, name, pubid, system):
        raise ValueError("document types are not part of the diagram")


path = Path(sys.argv[1])
assert path.is_file() and not path.is_symlink(), "expected a regular diagram file"
root = ET.parse(path, parser=ET.XMLParser(target=StaticDiagram())).getroot()
# This illustration can name the runtime it depicts. Only static SVG drawing
# primitives and same-document marker references belong in the README image.
elements = {
    f"{{{ns['s']}}}{name}"
    for name in ("svg", "g", "title", "desc", "defs", "marker", "path", "rect", "text", "line", "polyline")
}
markers = {f"url(#{marker.attrib['id']})" for marker in root.findall("s:defs/s:marker", ns)}
attributes = set(
    "aria-label aria-labelledby data-from data-to id role viewBox width height x x1 x2 y y1 y2 rx "
    "font-family font-size font-weight text-anchor transform d points fill stroke stroke-width "
    "stroke-dasharray marker-end marker-start markerHeight markerWidth orient refX refY".split()
)
for node in root.iter():
    assert node.tag in elements, node.tag
    assert node.attrib.keys() <= attributes, (node.tag, node.attrib.keys() - attributes)
    for key in ("fill", "stroke"):
        if key in node.attrib:
            assert re.fullmatch(r"none|#[0-9a-fA-F]{6}", node.attrib[key]), (key, node.attrib[key])
    for key in ("marker-start", "marker-end"):
        if key in node.attrib:
            reference = node.attrib[key]
            assert re.fullmatch(r"url\(#[A-Za-z_][\w.-]*\)", reference) and reference in markers, (key, reference)

ids_in_image = [node.attrib['id'] for node in root.iter() if 'id' in node.attrib]
assert len(ids_in_image) == len(set(ids_in_image)), "duplicate SVG id"

# The first view traces calls. Only the isolation view draws the host and its two runtimes.
gateway = root.find("s:g[@id='gateway-call']", ns)
assert gateway is not None, "missing gateway call flow"
nodes = {node.get('id') for node in gateway.findall('s:g', ns)}
routes = {(edge.get('data-from'), edge.get('data-to')) for edge in gateway.findall('s:path', ns)}
assert ('gateway-client', 'gateway-service') in routes, "missing client to gateway call"
assert ('gateway-worker', 'gateway-broker') in routes, "missing worker to broker call"
assert all(start in nodes and end in nodes for start, end in routes), "gateway route has no endpoint"

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

# A host broker drawn inside a guest, or an SBX VM nested inside SRT, would
# misstate which process can hold the subscription credential.
isolation = root.find(".//s:g[@id='runtime-isolation']", ns)
assert isolation is not None, "missing runtime isolation diagram"


def labeled_group(parent, group_id):
    group = parent.find(f"s:g[@id='{group_id}']", ns)
    assert group is not None, group_id
    label = group.get("aria-labelledby")
    assert label and group.find(f"s:text[@id='{label}']", ns) is not None, group_id
    return group


host, srt, sbx = (labeled_group(isolation, name) for name in ("isolation-host", "runtime-srt", "runtime-sbx"))
broker = labeled_group(host, "sbx-account-broker")
client = labeled_group(sbx, "sbx-native-client")
host_box, srt_box, sbx_box, broker_box, client_box = (
    bounds(group.find("s:rect", ns)) for group in (host, srt, sbx, broker, client)
)
for index, box in enumerate((host_box, srt_box, sbx_box)):
    for other in (host_box, srt_box, sbx_box)[:index]:
        assert box[2] <= other[0] or other[2] <= box[0] or box[3] <= other[1] or other[3] <= box[1], "overlapping isolation boundaries"
for owner, child in ((host_box, broker_box), (sbx_box, client_box)):
    assert owner[0] < child[0] < child[2] < owner[2] and owner[1] < child[1] < child[3] < owner[3]

connection = isolation.find("s:path[@id='sbx-responses-http']", ns)
assert connection is not None and connection.get("data-from") == broker.get("id") and connection.get("data-to") == client.get("id")
assert connection.get("marker-start") and connection.get("marker-end"), "bidirectional SBX Responses HTTP connection"
segment = re.fullmatch(r"M([\d.]+) ([\d.]+) H([\d.]+)", connection.attrib["d"])
assert segment, connection.attrib["d"]
start, y, end = map(float, segment.groups())
assert start == broker_box[2] and end == client_box[0]
assert max(broker_box[1], client_box[1]) < y < min(broker_box[3], client_box[3])
