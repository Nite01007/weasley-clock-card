"""Build shops.json for the card's Shopping face from OpenStreetMap (Overpass API).

The card never looks anything up while it runs: it only reads this static file.
Run this once (and again every few months as stores change), then copy the result
to /config/www/ and point the card's `shops_url` at it.

Example (two areas: 40 km around home, 20 km around a kid's college town):
    python build_shops.py --area 51.5074,-0.1278,40 --area 52.2053,0.1218,20

Each --area is LAT,LON,RADIUS_KM. Bigger areas mean a bigger file; ~2,800 shops
is about 250 KB.
"""
import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request

# Places you go to buy things. Services (car repair, salons, laundromats, storage)
# are left out on purpose, as are convenience/gas-station stores, liquor, cannabis
# and tobacco/vape. Those stops count as "Out and About". Edit to taste.
SHOP_TYPES = {
    "supermarket", "department_store", "mall", "wholesale", "general", "variety_store", "discount",
    "doityourself", "hardware", "trade", "paint", "garden_centre", "chemist", "cosmetics", "perfumery",
    "clothes", "shoes", "boutique", "fashion_accessories", "bag", "jewelry", "second_hand", "charity",
    "books", "gift", "stationery", "toys", "games", "video_games", "music", "musical_instrument", "art",
    "craft", "fabric", "sewing", "hobby", "pet", "electronics", "computer", "mobile_phone", "appliance",
    "furniture", "bed", "houseware", "interior_decoration", "kitchen", "lighting", "baby_goods",
    "sports", "outdoor", "bicycle", "car_parts", "florist", "bakery", "butcher", "greengrocer",
    "deli", "farm", "seafood", "cheese", "health_food", "frozen_food", "pastry", "confectionery",
}
AMENITY_TYPES = {"pharmacy", "marketplace"}
SERVERS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)


def query(lat, lon, radius_m):
    q = f"""[out:json][timeout:120];
(nwr[shop](around:{radius_m},{lat},{lon});nwr[amenity~"^(pharmacy|marketplace)$"](around:{radius_m},{lat},{lon}););
out center bb tags;"""
    last = None
    for server in SERVERS:
        req = urllib.request.Request(
            server,
            data=urllib.parse.urlencode({"data": q}).encode(),
            # Overpass answers 406 without a User-Agent.
            headers={"User-Agent": "weasley-clock-card/1.0 (build_shops.py)", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                return json.load(resp)["elements"]
        except urllib.error.HTTPError as err:  # 429/504 when the public servers are busy
            last = err
            time.sleep(20)
    raise last


def parse_area(text):
    lat, lon, km = (float(x) for x in text.split(","))
    return lat, lon, int(km * 1000)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--area", action="append", required=True, type=parse_area, help="LAT,LON,RADIUS_KM (repeatable)")
    ap.add_argument("--out", default="shops.json", help="output file (default: shops.json)")
    args = ap.parse_args()

    out, seen = [], set()
    for lat, lon, r in args.area:
        for e in query(lat, lon, r):
            t = e.get("tags", {})
            kind = t.get("shop") if t.get("shop") in SHOP_TYPES else t.get("amenity") if t.get("amenity") in AMENITY_TYPES else None
            if not kind or (e["type"], e["id"]) in seen:
                continue
            seen.add((e["type"], e["id"]))
            b = e.get("bounds")
            c = e.get("center") or ({"lat": e["lat"], "lon": e["lon"]} if "lat" in e else None)
            if not c and b:
                c = {"lat": (b["minlat"] + b["maxlat"]) / 2, "lon": (b["minlon"] + b["maxlon"]) / 2}
            if not c:
                continue
            rec = {"n": t.get("name") or t.get("brand") or "", "t": kind, "la": round(c["lat"], 6), "lo": round(c["lon"], 6)}
            if b:
                rec["b"] = [round(b["minlat"], 6), round(b["minlon"], 6), round(b["maxlat"], 6), round(b["maxlon"], 6)]
            out.append(rec)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(out)} shops, {sum('b' in s for s in out)} with building outlines -> {args.out}")


if __name__ == "__main__":
    main()
