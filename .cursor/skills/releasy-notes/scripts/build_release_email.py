#!/usr/bin/env python3
"""
Build a short, business-facing "Xeelo - Release Notes" email-style Word document.

This script only handles the mechanical part: turning already-written content
(title/version/date + lists of plain-English paragraphs) into a .docx file
with the exact styling of the reference template. It does NOT read the raw
DevOps ticket list or write the paragraph text - that judgment call (deciding
what's a Feature vs a Bug, translating/rewriting raw ticket text into clean
business prose, writing the summary) belongs to whoever is authoring the
content, per SKILL.md.

Usage:
    python build_release_email.py content.json output.docx

content.json schema:
{
  "version": "Labe-07.013",
  "release_date": "18 August 2026",
  "features": ["Paragraph 1 text.", "Paragraph 2 text.", ...],
  "bugs": ["Paragraph 1 text.", ...],
  "summary": ["Paragraph 1 text.", "Optional paragraph 2 text."]
}

Every string in "features"/"bugs" is rendered as one paragraph, formatted as
"Title. Explanation..." in a single run (no bold inside the paragraph body -
only the section headings and the Version:/Release date: labels are bold).
"summary" may be one paragraph or a short list of paragraphs.
"""
import sys
import json
from docx import Document
from docx.shared import Pt, Twips, RGBColor
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

FONT = "Calibri"
TITLE_COLOR = "1F3864"
HEADING_COLOR = "1F3864"
BODY_COLOR = "222222"


def set_run_font(run, size_pt, color_hex, bold=False):
    run.font.name = FONT
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.insert(0, rFonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rFonts.set(qn(attr), FONT)
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run.font.color.rgb = RGBColor.from_string(color_hex)


def add_plain_paragraph(doc, text, size_pt, color_hex, bold=False,
                         before_pt=0, after_pt=8):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(before_pt)
    p.paragraph_format.space_after = Pt(after_pt)
    r = p.add_run(text)
    set_run_font(r, size_pt, color_hex, bold)
    return p


def add_label_value_paragraph(doc, label, value, size_pt=11,
                               color_hex=BODY_COLOR, before_pt=0, after_pt=4):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(before_pt)
    p.paragraph_format.space_after = Pt(after_pt)
    r1 = p.add_run(label)
    set_run_font(r1, size_pt, color_hex, bold=True)
    r2 = p.add_run(value)
    set_run_font(r2, size_pt, color_hex, bold=False)
    return p


def add_heading(doc, text):
    return add_plain_paragraph(doc, text, 13, HEADING_COLOR, bold=True,
                                before_pt=16, after_pt=6)


def add_item_paragraph(doc, text):
    return add_plain_paragraph(doc, text, 11, BODY_COLOR, bold=False,
                                before_pt=0, after_pt=8)


def set_page(doc):
    section = doc.sections[0]
    section.page_width = Twips(12240)
    section.page_height = Twips(15840)
    section.top_margin = Twips(1080)
    section.bottom_margin = Twips(1080)
    section.left_margin = Twips(1260)
    section.right_margin = Twips(1260)
    section.header_distance = Twips(708)
    section.footer_distance = Twips(708)


def build(content, output_path):
    doc = Document()
    set_page(doc)

    title = content.get("document_title") or "Xeelo – Release Notes"
    add_plain_paragraph(doc, title, 18, TITLE_COLOR,
                         bold=True, before_pt=0, after_pt=8)
    add_label_value_paragraph(doc, "Version: ", content["version"])
    add_label_value_paragraph(doc, "Release date: ", content["release_date"])

    features = content.get("features", [])
    if features:
        add_heading(doc, "New Features")
        for text in features:
            add_item_paragraph(doc, text)

    bugs = content.get("bugs", [])
    if bugs:
        add_heading(doc, "Bug Fixes")
        for text in bugs:
            add_item_paragraph(doc, text)

    summary = content.get("summary", [])
    if isinstance(summary, str):
        summary = [summary]
    if summary:
        add_heading(doc, "Summary")
        for text in summary:
            add_item_paragraph(doc, text)

    doc.save(output_path)


def main():
    if len(sys.argv) != 3:
        print("Usage: python build_release_email.py content.json output.docx",
              file=sys.stderr)
        sys.exit(1)
    content_path, output_path = sys.argv[1], sys.argv[2]
    with open(content_path, "r", encoding="utf-8") as f:
        content = json.load(f)
    for required in ("version", "release_date"):
        if required not in content:
            print(f"content.json is missing required field: {required}",
                  file=sys.stderr)
            sys.exit(1)
    build(content, output_path)
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
