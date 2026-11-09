"""Prepare factual example assets from independently downloaded public datasets.

Run from the CRYChart root after the listed sources exist in
codex_artifact/map-source-data. This file does not inspect chart vendor code.
"""
import csv
import datetime
import hashlib
import io
import json
import math
import pathlib
import zipfile

SOURCE = pathlib.Path('codex_artifact/map-source-data')
DEST = pathlib.Path('examples/data')
DEST.mkdir(parents=True, exist_ok=True)
outputs = []

def read(name):
    return json.loads((SOURCE / name).read_text(encoding='utf8'))

def write(name, value, sources, transformation):
    data = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf8')
    (DEST / name).write_bytes(data)
    outputs.append({'file': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'sources': sources, 'transformation': transformation})
    print(name, len(data), flush=True)

def coordinates(value, precision=4):
    return [coordinates(v, precision) for v in value] if isinstance(value, list) else round(value, precision)

world = read('world-50m.geojson')
features = []
for feature in world['features']:
    p = feature['properties']
    iso = p['ISO_A3_EH'] if p['ISO_A3_EH'] != '-99' else p['ADM0_A3']
    features.append({'type': 'Feature', 'id': iso, 'properties': {'name': p['NAME'], 'iso3': iso, 'continent': p['CONTINENT'], 'label': [p['LABEL_X'], p['LABEL_Y']]}, 'geometry': {'type': feature['geometry']['type'], 'coordinates': coordinates(feature['geometry']['coordinates'])}})
write('world-countries.json', {'type': 'FeatureCollection', 'features': features}, ['world-50m.geojson'], 'Keep all 242 country features and all polygon rings; round longitude/latitude to 4 decimals; retain display name, ISO alpha-3, continent, and Natural Earth label coordinates.')

states = read('us-states-110m.geojson')
features = []
for f in states['features']:
    p = f['properties']
    if p['iso_3166_2'] in ('US-AK', 'US-HI'): continue
    features.append({'type': 'Feature', 'id': p['iso_3166_2'], 'properties': {'name': p['name']}, 'geometry': {'type': f['geometry']['type'], 'coordinates': coordinates(f['geometry']['coordinates'])}})
write('us-contiguous-states.json', {'type': 'FeatureCollection', 'features': features}, ['us-states-110m.geojson'], 'Keep the 48 contiguous states plus District of Columbia; preserve polygon rings; round coordinates to 4 decimals.')

population = {row['countryiso3code']: row['value'] for row in read('population-2018.json')[1] if row['value'] is not None and row['countryiso3code']}
growth = {}
for row in read('population-growth.json')[1]:
    code = row['countryiso3code']
    if code and row['value'] is not None: growth.setdefault(code, {})[row['date']] = round(row['value'], 5)
write('world-bank-population.json', {'population2018': population, 'growth1961to2019': growth}, ['population-2018.json', 'population-growth.json'], 'Retain population total in 2018 and annual growth percentages from 1961 through 2019 by ISO code; omit missing values; round growth to 5 decimals.')

zones, zone_sources = [], []
for code in ['DK_1', 'DK_2', 'EE', 'FI', 'LT', 'LV', 'NO_1', 'NO_2', 'NO_3', 'NO_4', 'NO_5', 'SE_1', 'SE_2', 'SE_3', 'SE_4']:
    name = code + '.geojson'
    for f in read(name)['features']:
        zones.append({'type': 'Feature', 'id': code.replace('_', ''), 'properties': {'name': code.replace('_', '')}, 'geometry': {'type': f['geometry']['type'], 'coordinates': coordinates(f['geometry']['coordinates'])}})
    zone_sources.append(name)
write('nordic-bidding-zones.json', {'type': 'FeatureCollection', 'features': zones}, zone_sources, 'Combine 15 Nordic/Baltic bidding-zone files from EnergieID entsoe-py; keep real Polygon/MultiPolygon outlines and holes, round coordinates to 4 decimals; rename codes without underscores. Upstream notes that Swedish internal boundaries were manually redrawn.')

start, end = datetime.date(2020, 11, 1), datetime.date(2022, 3, 11)
days = [(start + datetime.timedelta(days=i)).isoformat() for i in range((end-start).days+1)]
date_index = {date: i for i, date in enumerate(days)}
metrics = ['people_vaccinated_per_hundred', 'new_cases_smoothed_per_million', 'hosp_patients_per_million', 'icu_patients_per_million']
covid = {}
with (SOURCE / 'owid-covid-data.csv').open(encoding='utf8', newline='') as f:
    for row in csv.DictReader(f):
        index = date_index.get(row['date'])
        if index is None: continue
        code = row['iso_code']
        if len(code) != 3 and code != 'OWID_WRL': continue
        records = covid.setdefault(code, {'name': row['location'], 'continent': row['continent'], 'population': float(row['population']) if row['population'] else None, 'rows': []})
        values = [round(float(row[key]), 4) if row[key] and math.isfinite(float(row[key])) else None for key in metrics]
        if any(value is not None for value in values): records['rows'].append([index, *values])
write('covid-history.json', {'dates': days, 'metrics': metrics, 'countries': covid}, ['owid-covid-data.csv'], 'Retain daily records 2020-11-01 through 2022-03-11, countries and OWID world aggregate; keep vaccination percentage plus smoothed new cases/hospital/ICU per million, population and country name. Missing metrics stay null. Values rounded to 4 decimals; source revisions can differ from the historical reference screenshot.')

route = []
with zipfile.ZipFile(SOURCE / 'AirView_DublinCity_Measurements_CSV.zip') as z:
    with z.open('AirView_DublinCity_Measurements_ugm3.csv') as raw:
        for row in csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig')):
            stamp = row['gps_timestamp']
            if not stamp.startswith('2021-05-26 '): continue
            if not '2021-05-26 08:00:00' <= stamp[:19] <= '2021-05-26 08:46:00': continue
            try: lon, lat, pm = float(row['longitude']), float(row['latitude']), float(row['PM25_ugm3'])
            except ValueError: continue
            if not all(map(math.isfinite, [lon, lat, pm])) or not (-6.38 <= lon <= -6.20 and 53.30 <= lat <= 53.43): continue
            timestamp = int(datetime.datetime.strptime(stamp[:19], '%Y-%m-%d %H:%M:%S').replace(tzinfo=datetime.timezone.utc).timestamp())
            route.append([timestamp, round(lon, 7), round(lat, 7), pm])
route.sort(key=lambda row: row[0])
unique = {row[0]: row for row in route}
route = list(unique.values())
write('dublin-air-view-route.json', {'columns': ['timestampSecondsUTC', 'longitude', 'latitude', 'PM25_ugm3'], 'rows': route}, ['AirView_DublinCity_Measurements_CSV.zip', 'AirView_DublinCity_Measurements_Metadata.txt'], 'Extract actual finite PM2.5 measurements on 2021-05-26 14:40–15:20 UTC inside longitude[-6.38,-6.20], latitude[53.30,53.43]. Sort by timestamp, retain one row per second, round geographic positions to 7 decimals. Gaps are preserved by timestamp and must not count as exposure time.')
print('route rows', len(route), 'range', route[:1], route[-1:], flush=True)

roads = []
for f in read('AirView_DublinCity_RoadData_GeoJSON.geojson')['features']:
    geom = f['geometry']
    if geom['type'] != 'LineString': continue
    points = geom['coordinates']
    if not any(-6.38 <= p[0] <= -6.20 and 53.30 <= p[1] <= 53.43 for p in points): continue
    roads.append({'name': f['properties'].get('osm_name') or '', 'class': f['properties'].get('osm_fclass'), 'points': coordinates(points, 6)})
write('dublin-road-segments.json', roads, ['AirView_DublinCity_RoadData_GeoJSON.geojson'], 'Retain actual LineString street segments intersecting the displayed Dublin extent and name/class; round to 6 decimals. Geometry derives from OpenStreetMap as identified by upstream osm_id. Retain separate segments; never connect unrelated roads.')

downloads = read('downloads.json') + read('downloads-extra.json') + [read('owid-download.json')]
manifest = {'preparedAtUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'purpose': 'Independent public factual assets for original CRYChart example implementations', 'sources': [item for item in downloads if 'sha256' in item], 'outputs': outputs}
(DEST / 'map-data-provenance.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf8')
(DEST / 'entsoe-MIT-LICENSE.txt').write_text((SOURCE / 'entsoe-license.txt').read_text(encoding='utf8'), encoding='utf8')
