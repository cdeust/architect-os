"""Check the typography of the hand-drawn README diagram.

One font family, declared once on the root element, and at most five sizes. Every
text names its role with `data-type-role`; the scale is declared in a comment
that opens the file, and each role takes the size the comment gives it. The
checks that read the drawing come first, so a diagram that drifted fails on the
real attributes before the declared scale is consulted.

Usage: architecture_typography.py DIAGRAM.svg (exit 0 when it holds, 1 and a reason when not).
"""
import re
import sys
from xml.etree import ElementTree as ET

ROLES = ("diagram-title", "section-title", "brick-name", "brick-text", "badge", "legend")
MAX_SIZES = 5
SVG = "{http://www.w3.org/2000/svg}"
TEXT = SVG + "text"
FAMILY = re.compile(r"[A-Za-z]+(?: [A-Za-z]+)*")
SIZE = re.compile(r"[1-9][0-9]*(?:\.[0-9]+)?")
ENTRY = re.compile(r"([a-z-]+) = ([1-9][0-9]*(?:\.[0-9]+)?)")
PLACEMENT = re.compile(r"(?:(?:translate|rotate)\([-+.\d\s,]+\)\s*)+")


def check_typography(root):
    check_drawing(root)
    sizes = read_scale(root)
    used = set()
    for node in root.iter(TEXT):
        role = node.get("data-type-role")
        assert role in sizes, f"missing or unknown type role for {node.text!r}"
        assert node.get("font-size") == sizes[role], f"{node.text!r}: {role} requires {sizes[role]}"
        if node.text in {"ready", "next"}:
            assert role == "badge", f"status {node.text!r} must use the badge role"
        used.add(role)
    assert used == set(ROLES), f"unused typography roles: {sorted(set(ROLES) - used)}"


def check_drawing(root):
    family = root.get("font-family", "")
    assert FAMILY.fullmatch(family), f"expected one font family on the root, got {family!r}"
    drawn = set()
    for node in root.iter():
        if node.tag is ET.Comment:
            continue
        assert node.tag != SVG + "style", "a style sheet can set a second family or size"
        if node is not root:
            assert "font-family" not in node.attrib, "the font family belongs on the SVG root"
        assert "style" not in node.attrib, "a style attribute can set a second family or size"
        if "transform" in node.attrib and next(node.iter(TEXT), None) is not None:
            assert PLACEMENT.fullmatch(node.attrib["transform"]), "a transform resizes or distorts text"
        if node.tag != TEXT:
            assert "font-size" not in node.attrib and "data-type-role" not in node.attrib, (
                "only text may declare a type role or size"
            )
            continue
        size = node.get("font-size", "")
        assert SIZE.fullmatch(size), f"{node.text!r}: expected a font-size, got {size!r}"
        drawn.add(float(size))
    assert len(drawn) <= MAX_SIZES, f"{len(drawn)} sizes drawn, at most {MAX_SIZES}: {sorted(drawn)}"


def read_scale(root):
    header = root[0] if len(root) else None
    assert header is not None and header.tag is ET.Comment, "the SVG must open with its typography scale"
    lines = [line.strip() for line in header.text.strip().splitlines()]
    assert lines[0] == "Typography (SVG units)", "missing typography scale"
    family = root.get("font-family")
    assert lines[1:2] == [f"family = {family}"], "declared and rendered font families differ"
    sizes = {}
    for line in lines[2:]:
        entry = ENTRY.fullmatch(line)
        assert entry, f"invalid typography declaration: {line}"
        role, size = entry.groups()
        assert role not in sizes, f"repeated typography role: {role}"
        sizes[role] = size
    assert sizes.keys() == set(ROLES), f"expected the six typography roles, got {sorted(sizes)}"
    assert len(set(sizes.values())) <= MAX_SIZES, f"the scale declares more than {MAX_SIZES} sizes"
    return sizes


class _Tree(ET.TreeBuilder):
    """The same static reading as architecture-loop.py: no document type, no processing instruction."""

    def __init__(self):
        super().__init__(insert_comments=True)

    def pi(self, target, text):
        raise AssertionError("processing instructions are not part of the diagram")

    def doctype(self, name, pubid, system):
        raise AssertionError("document types are not part of the diagram")


if __name__ == "__main__":
    assert len(sys.argv) == 2, "usage: architecture_typography.py DIAGRAM.svg"
    try:
        check_typography(ET.parse(sys.argv[1], parser=ET.XMLParser(target=_Tree())).getroot())
    except AssertionError as failure:
        print(f"{sys.argv[1]}: {failure}", file=sys.stderr)
        sys.exit(1)
