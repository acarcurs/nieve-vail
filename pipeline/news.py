"""Recent headlines about Vail's terrain openings (Google News RSS). The Spanish summary and the
news signal used by the Back Bowls model are written twice a day by a Claude task (data/insights.json)."""
import datetime as dt
import email.utils
import re
import xml.etree.ElementTree as ET

from common import get

QUERIES = ['"Vail" "Back Bowls"', '"Vail Mountain" terrain opening', '"Vail" snow opening day lifts']


def fetch(days=14, limit=10):
    seen, items = set(), []
    for q in QUERIES:
        try:
            xml = get("https://news.google.com/rss/search", params=dict(q=f"{q} when:{days}d", hl="en-US", gl="US", ceid="US:en"),
                      kind="text", timeout=30, tries=2)
        except Exception:  # noqa: BLE001
            continue
        root = ET.fromstring(xml)
        for it in root.iter("item"):
            title = (it.findtext("title") or "").strip()
            link = (it.findtext("link") or "").strip()
            src = it.find("source")
            source = src.text.strip() if src is not None and src.text else ""
            title = re.sub(r"\s+-\s+" + re.escape(source) + r"$", "", title) if source else title
            key = title.lower()[:80]
            if not title or key in seen:
                continue
            seen.add(key)
            try:
                date = dt.datetime(*email.utils.parsedate(it.findtext("pubDate"))[:6]).date().isoformat()
            except Exception:  # noqa: BLE001
                date = None
            items.append(dict(title=title, source=source, url=link, date=date,
                              bb=bool(re.search(r"back bowl|blue sky|sun up|sun down|china bowl|siberia|mongolia", title, re.I))))
    items.sort(key=lambda x: x["date"] or "", reverse=True)
    return items[:limit]
