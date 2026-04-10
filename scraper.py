#!/usr/bin/env python3
"""
Boston Marathon 2026 — Event Auto-Updater Scraper
=================================================
Scrapes known sources for new Boston Marathon weekend events
and merges them into data/events.json.

Run manually:
    python3 scraper.py

Or set up a cron job (runs nightly at midnight):
    0 0 * * * cd /path/to/boston-marathon-events && python3 scraper.py >> logs/scraper.log 2>&1
"""

import json
import os
import re
import time
import logging
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
from typing import Optional

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Installing required packages...")
    import subprocess
    subprocess.check_call(["pip3", "install", "requests", "beautifulsoup4", "lxml"])
    import requests
    from bs4 import BeautifulSoup

# ── Config ──────────────────────────────────────────────
DATA_FILE  = Path(__file__).parent / "data" / "events.json"
LOG_DIR    = Path(__file__).parent / "logs"
LOG_FILE   = LOG_DIR / "scraper.log"
MARATHON_YEAR = 2026
MARATHON_DATE = "2026-04-20"
WEEKEND_DATES = ["2026-04-14","2026-04-15","2026-04-16","2026-04-17",
                 "2026-04-18","2026-04-19","2026-04-20","2026-04-21"]

LOG_DIR.mkdir(exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# ── Sources to scrape ────────────────────────────────────
SOURCES = [
    {
        "name": "BAA Marathon Weekend",
        "url": "https://www.baa.org/races/boston-marathon/bmweekend/",
        "type": "html",
    },
    {
        "name": "Marathon Weekend .com",
        "url": "https://www.marathon-weekend.com/boston/2026",
        "type": "html",
    },
    {
        "name": "Heartbreak Hill RC",
        "url": "https://heartbreak.run/blogs/heartbeat/the-ultimate-boston-2026-guide",
        "type": "html",
    },
    {
        "name": "Eventbrite - Marathon Sports",
        "url": "https://www.eventbrite.com/cc/whats-happening-in-boston-2026-4829945",
        "type": "eventbrite",
    },
    {
        "name": "Tracksmith Events",
        "url": "https://www.tracksmith.com/events",
        "type": "html",
    },
    {
        "name": "RunSignUp Boston Shakeout",
        "url": "https://runsignup.com/Race/MA/Boston/ZapposBostonMarathonShakeoutRun",
        "type": "html",
    },
    {
        "name": "Boston Discovery Guide April",
        "url": "https://www.boston-discovery-guide.com/boston-event-calendar-april.html",
        "type": "html",
    },
    {
        "name": "Meet Boston - Marathon Events",
        "url": "https://www.meetboston.com/events/festivals-and-annual-events/boston-marathon/",
        "type": "html",
    },
    {
        "name": "Eventbrite Boston April 2026",
        "url": "https://www.eventbrite.com/d/ma--boston/boston-marathon--2026/",
        "type": "eventbrite_search",
    },
    {
        "name": "RunGuides Boston 2026",
        "url": "https://www.runguides.com/boston/runs",
        "type": "html",
    },
    {
        "name": "BostonCentral Events",
        "url": "https://www.bostoncentral.com/events/races/",
        "type": "html",
    },
]

# ── Marathon-weekend-specific keywords ───────────────────
KEYWORDS = [
    "boston marathon", "marathon weekend", "patriot", "shakeout",
    "expo", "fan fest", "mile 27", "mile27", "boylston",
    "hopkinton", "heartbreak hill", "april 14", "april 15", "april 16",
    "april 17", "april 18", "april 19", "april 20", "april 21",
]

DATE_PATTERNS = [
    (r"april\s+14",      "2026-04-14"),
    (r"april\s+15",      "2026-04-15"),
    (r"april\s+16",      "2026-04-16"),
    (r"april\s+17",      "2026-04-17"),
    (r"april\s+18",      "2026-04-18"),
    (r"april\s+19",      "2026-04-19"),
    (r"april\s+20",      "2026-04-20"),
    (r"april\s+21",      "2026-04-21"),
    (r"apr\.?\s+14",     "2026-04-14"),
    (r"apr\.?\s+15",     "2026-04-15"),
    (r"apr\.?\s+16",     "2026-04-16"),
    (r"apr\.?\s+17",     "2026-04-17"),
    (r"apr\.?\s+18",     "2026-04-18"),
    (r"apr\.?\s+19",     "2026-04-19"),
    (r"apr\.?\s+20",     "2026-04-20"),
    (r"apr\.?\s+21",     "2026-04-21"),
    (r"4/14/2026",       "2026-04-14"),
    (r"4/15/2026",       "2026-04-15"),
    (r"4/16/2026",       "2026-04-16"),
    (r"4/17/2026",       "2026-04-17"),
    (r"4/18/2026",       "2026-04-18"),
    (r"4/19/2026",       "2026-04-19"),
    (r"4/20/2026",       "2026-04-20"),
    (r"4/21/2026",       "2026-04-21"),
    (r"patriots.?\s*day","2026-04-20"),
    (r"marathon\s+monday","2026-04-20"),
    (r"race\s+day",      "2026-04-20"),
]

# ── Load / Save ──────────────────────────────────────────
def load_data() -> dict:
    if DATA_FILE.exists():
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"meta": {}, "events": []}

def save_data(data: dict):
    data["meta"]["last_updated"] = datetime.now(timezone.utc).isoformat()
    DATA_FILE.parent.mkdir(exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    log.info(f"Saved {len(data['events'])} events to {DATA_FILE}")

# ── Fetch ────────────────────────────────────────────────
def fetch_html(url: str, timeout: int = 15) -> Optional[str]:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        log.warning(f"Failed to fetch {url}: {e}")
        return None

# ── Parse helpers ────────────────────────────────────────
def guess_date(text: str) -> Optional[str]:
    text_lower = text.lower()
    for pattern, date in DATE_PATTERNS:
        if re.search(pattern, text_lower):
            return date
    return None

def is_marathon_weekend_event(text: str) -> bool:
    text_lower = text.lower()
    return any(kw in text_lower for kw in KEYWORDS)

def extract_time(text: str) -> str:
    match = re.search(
        r'\b(\d{1,2}(?::\d{2})?\s*(?:AM|PM)(?:\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM))?)',
        text, re.IGNORECASE
    )
    return match.group(0).strip() if match else "TBA"

def next_id(events: list) -> int:
    return max((e.get("id", 0) for e in events), default=0) + 1

def event_exists(events: list, name: str, date: Optional[str]) -> bool:
    name_clean = name.lower().strip()
    for e in events:
        # Fuzzy name match (80% similarity)
        existing = e.get("name", "").lower().strip()
        if existing == name_clean:
            return True
        # Check if the name is substantially included
        if len(name_clean) > 10 and name_clean[:20] in existing:
            return True
        if len(existing) > 10 and existing[:20] in name_clean:
            return True
    return False

# ── Scraper: Generic HTML ────────────────────────────────
def scrape_html(source: dict, existing_events: list) -> list:
    new_events = []
    html = fetch_html(source["url"])
    if not html:
        return []

    soup = BeautifulSoup(html, "lxml")

    # Remove script/style noise
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    # Candidate containers: divs, articles, sections, li items
    candidates = soup.find_all(
        ["article", "section", "div", "li"],
        limit=500
    )

    for el in candidates:
        text = el.get_text(separator=" ", strip=True)
        if len(text) < 30 or len(text) > 2000:
            continue
        if not is_marathon_weekend_event(text):
            continue

        # Try to find an event title
        title_el = el.find(re.compile(r"^h[1-6]$"))
        if not title_el:
            title_el = el.find(class_=re.compile(r"title|name|heading|event", re.I))
        if not title_el:
            continue

        name = title_el.get_text(strip=True)
        if len(name) < 5 or len(name) > 120:
            continue
        # Skip day/date header elements (e.g. "Tuesday , 14 Apr", "Wed 15 April")
        if re.match(
            r'^\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*[\s,]+(?:\d{1,2}\s+)?(?:Apr|April)\s*\d{0,2}\s*$',
            name, re.IGNORECASE
        ):
            continue
        if not is_marathon_weekend_event(name + " " + text):
            continue

        date = guess_date(text) or guess_date(name)
        if not date:
            continue

        if event_exists(existing_events + new_events, name, date):
            continue

        # Find link
        link = ""
        a_tag = el.find("a", href=True)
        if a_tag:
            href = a_tag["href"]
            link = urljoin(source["url"], href) if href.startswith("/") else href

        ev = {
            "id": next_id(existing_events + new_events),
            "date": date,
            "day": date_to_day(date),
            "time": extract_time(text),
            "name": name,
            "category": guess_category(name + " " + text),
            "location": guess_location(text),
            "address": "",
            "description": text[:300].strip(),
            "sponsors": [],
            "big_names": [],
            "giveaways": guess_giveaways(text),
            "signup_link": link,
            "cost": guess_cost(text),
            "source": source["name"],
            "_scraped": True,
        }
        new_events.append(ev)
        log.info(f"  [NEW] {name} ({date})")

    return new_events

# ── Scraper: Eventbrite ──────────────────────────────────
def scrape_eventbrite(source: dict, existing_events: list) -> list:
    new_events = []
    html = fetch_html(source["url"])
    if not html:
        return []

    soup = BeautifulSoup(html, "lxml")

    # Eventbrite uses structured event cards
    for card in soup.find_all(attrs={"data-event-id": True}):
        name_el = card.find(class_=re.compile(r"summary|name|title", re.I))
        if not name_el:
            continue
        name = name_el.get_text(strip=True)
        if len(name) < 5:
            continue

        text = card.get_text(separator=" ", strip=True)
        date = guess_date(text)
        if not date:
            continue
        if not is_marathon_weekend_event(name + " " + text):
            continue
        if event_exists(existing_events + new_events, name, date):
            continue

        link = ""
        a_tag = card.find("a", href=True)
        if a_tag:
            link = a_tag["href"]
            if link.startswith("/"):
                link = "https://www.eventbrite.com" + link

        ev = {
            "id": next_id(existing_events + new_events),
            "date": date,
            "day": date_to_day(date),
            "time": extract_time(text),
            "name": name,
            "category": guess_category(name + " " + text),
            "location": guess_location(text),
            "address": "Boston, MA",
            "description": text[:300].strip(),
            "sponsors": [],
            "big_names": [],
            "giveaways": guess_giveaways(text),
            "signup_link": link,
            "cost": guess_cost(text),
            "source": "Eventbrite",
            "_scraped": True,
        }
        new_events.append(ev)
        log.info(f"  [NEW] {name} ({date})")

    return new_events

# ── Guess helpers ────────────────────────────────────────
def guess_category(text: str) -> str:
    t = text.lower()
    if "shakeout" in t or "shake out" in t:           return "Shakeout Run"
    if "5k" in t or "race" in t or "mile run" in t:   return "Race"
    if "marathon" in t and ("run" in t or "race" in t): return "Marathon"
    if "expo" in t:                                     return "Expo"
    if "fan fest" in t or "fanfest" in t:               return "Fan Event"
    if "party" in t or "afterparty" in t:               return "Post-Race Party"
    if "film" in t or "movie" in t or "premiere" in t: return "Film / Community"
    if "meet" in t and "greet" in t:                    return "Meet & Greet"
    if "dinner" in t or "carbo" in t or "pasta" in t:  return "Dinner Event"
    if "block party" in t:                              return "Block Party"
    if "cheer" in t or "spectator" in t:                return "Spectator / Cheer Zone"
    if "pop.up" in t or "shop" in t or "brand" in t:   return "Brand Activation"
    if "awards" in t or "honors" in t:                  return "Awards / Community"
    if "podcast" in t:                                  return "Podcast / Community"
    if "panel" in t or "screening" in t:                return "Film / Community"
    if "community" in t or "run club" in t:             return "Community Run"
    return "Brand Activation"

def guess_location(text: str) -> str:
    loc_patterns = [
        (r"Hynes Convention Center",       "Hynes Convention Center"),
        (r"City Hall Plaza",               "City Hall Plaza"),
        (r"Heartbreak Hill Running",       "Heartbreak Hill Running Co."),
        (r"Tracksmith|Trackhouse",         "Tracksmith Trackhouse, 285 Newbury St"),
        (r"Fairmont Copley",               "Fairmont Copley Plaza Hotel"),
        (r"Kenmore Square",                "Kenmore Square"),
        (r"Boylston Street|Boylston St",   "Boylston Street"),
        (r"Coolidge Corner",               "Coolidge Corner, Brookline"),
        (r"Hopkinton",                     "Hopkinton, MA"),
        (r"Boston Common",                 "Boston Common"),
        (r"Newbury Street|Newbury St",     "Newbury Street"),
        (r"Back Bay",                      "Back Bay, Boston"),
        (r"Rose Kennedy Greenway",         "Rose Kennedy Greenway"),
        (r"North End",                     "North End, Boston"),
        (r"South End",                     "South End, Boston"),
        (r"Cambridge",                     "Cambridge, MA"),
    ]
    for pattern, loc in loc_patterns:
        if re.search(pattern, text, re.I):
            return loc
    return "Boston, MA"

def guess_cost(text: str) -> str:
    t = text.lower()
    if "free" in t:   return "Free"
    if "$10" in t:    return "$10"
    if "$" in text:
        m = re.search(r"\$(\d+)", text)
        if m:         return f"${m.group(1)}"
    return "Free"

def guess_giveaways(text: str) -> list:
    giveaways = []
    t = text.lower()
    checks = [
        ("giveaway" in t or "give away" in t, "Giveaways"),
        ("swag" in t,                           "Swag"),
        ("coffee" in t,                         "Coffee"),
        ("breakfast" in t,                      "Breakfast"),
        ("sunglasses" in t,                     "Sunglasses"),
        ("popcorn" in t,                        "Popcorn"),
        ("poster" in t,                         "Free poster"),
        ("beer" in t,                           "Beer"),
        ("beverages" in t or "drinks" in t,     "Beverages"),
        ("demo" in t and "shoe" in t,           "Demo shoes"),
        ("medal engrav" in t,                   "Medal engraving"),
        ("portrait" in t,                       "Photos"),
    ]
    for condition, label in checks:
        if condition:
            giveaways.append(label)
    return giveaways

def date_to_day(date: str) -> str:
    days = {
        "2026-04-14": "Tuesday",
        "2026-04-15": "Wednesday",
        "2026-04-16": "Thursday",
        "2026-04-17": "Friday",
        "2026-04-18": "Saturday",
        "2026-04-19": "Sunday",
        "2026-04-20": "Monday",
        "2026-04-21": "Tuesday",
    }
    return days.get(date, "")

# ── Main ─────────────────────────────────────────────────
def run():
    log.info("=" * 60)
    log.info(f"Boston Marathon 2026 Event Scraper — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    data = load_data()
    existing = data.get("events", [])
    log.info(f"Loaded {len(existing)} existing events")

    all_new = []

    for source in SOURCES:
        log.info(f"\nScraping: {source['name']} ({source['url']})")
        try:
            if source["type"] == "eventbrite":
                new = scrape_eventbrite(source, existing + all_new)
            elif source["type"] == "eventbrite_search":
                new = scrape_eventbrite(source, existing + all_new)
            else:
                new = scrape_html(source, existing + all_new)
            log.info(f"  → Found {len(new)} new events")
            all_new.extend(new)
        except Exception as e:
            log.error(f"  Error scraping {source['name']}: {e}")
        time.sleep(1.5)  # polite delay between requests

    if all_new:
        log.info(f"\n✅ Adding {len(all_new)} new events to database")
        data["events"].extend(all_new)
        data["meta"]["sources_checked"] = [s["url"] for s in SOURCES]
        save_data(data)
    else:
        log.info("\n✓ No new events found. Database is up to date.")
        # Still update the timestamp
        data["meta"]["last_checked"] = datetime.now(timezone.utc).isoformat()
        save_data(data)

    log.info(f"\nTotal events in database: {len(data['events'])}")
    log.info("Scraper run complete.\n")
    return len(all_new)

if __name__ == "__main__":
    run()
