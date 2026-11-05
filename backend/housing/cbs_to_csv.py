"""Convert the CBS price index export (testnewdata.xlsx) to model/reference/cbs_house_price_index.csv.

Usage: python -m housing.cbs_to_csv <xlsx> (from backend/). Standard library only. Year-on-year is the 12-month change of the index,
computed here (the export's column C gives the same numbers as a fraction). Time = year + (month - 0.5) / 12.
"""
import csv, sys, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"]
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def rows(path: Path):
    z = zipfile.ZipFile(path)
    ss = ["".join(t.text or "" for t in si.iter(f"{{{NS['m']}}}t")) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]
    for row in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter(f"{{{NS['m']}}}row"):
        vals = {}
        for c in row.findall("m:c", NS):
            v = c.find("m:v", NS)
            if v is not None:
                vals["".join(ch for ch in c.get("r") if ch.isalpha())] = ss[int(v.text)] if c.get("t") == "s" else v.text
        yield vals


def main(src: str) -> None:
    series = []
    for r in rows(Path(src)):
        parts = r.get("A", "").split()
        if len(parts) == 2 and parts[1] in MONTHS and "B" in r:
            series.append((int(parts[0]), MONTHS.index(parts[1]) + 1, float(r["B"])))
    out = Path(__file__).resolve().parents[2] / "model" / "reference" / "cbs_house_price_index.csv"
    with out.open("w", newline="") as fh:
        w = csv.writer(fh); w.writerow(["year", "index_2020_100", "yoy_pct"])
        for i, (y, m, v) in enumerate(series):
            yoy = 100 * (v / series[i - 12][2] - 1) if i >= 12 else ""
            w.writerow([round(y + (m - 0.5) / 12, 4), v, round(yoy, 3) if yoy != "" else ""])
    print(f"{len(series)} months, {series[0][:2]} to {series[-1][:2]} -> {out}")


if __name__ == "__main__":
    main(sys.argv[1])
