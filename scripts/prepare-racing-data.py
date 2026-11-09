"""Project a pinned, previously downloaded OWID CSV into a small offline demo fixture."""
from pathlib import Path
import csv
import hashlib
import json
import urllib.request

root = Path(__file__).resolve().parents[1]
folder = root / 'codex_artifact' / 'map-source-data'
source = folder / 'owid-covid-data.csv'
expected = '8473d0f0fdf962e1ffbd5b85b18726fc96a49bab109e271186c339725a12b10c'
url = 'https://raw.githubusercontent.com/owid/covid-19-data/master/public/data/owid-covid-data.csv'
if not source.exists():
    folder.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, source)
digest = hashlib.sha256(source.read_bytes()).hexdigest()
if digest != expected:
    raise RuntimeError('Source hash changed; review provenance before replacing the fixture')
countries = {'ITA': 'Italy', 'ESP': 'Spain', 'USA': 'US', 'DEU': 'Germany', 'BRA': 'Brazil', 'TUR': 'Turkey', 'RUS': 'Russia', 'IND': 'India'}
by_date = {}
with source.open(newline='', encoding='utf-8-sig') as file:
    for row in csv.DictReader(file):
        if row['iso_code'] in countries and '2020-03-01' <= row['date'] <= '2020-09-01':
            by_date.setdefault(row['date'], {})[row['iso_code']] = float(row['total_cases']) if row['total_cases'] else None
data = {'countries': [{'id': key, 'name': name} for key, name in countries.items()], 'days': [{'date': day, 'values': [values.get(key) for key in countries]} for day, values in sorted(by_date.items())], 'metric': 'total_cases'}
destination = root / 'examples' / 'data' / 'covid-racing.json'
destination.write_text(json.dumps(data, separators=(',', ':')) + '\n', encoding='utf-8')
provenance = {'source': url, 'sourceSHA256': digest, 'fileSHA256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'metric': 'total_cases', 'countries': len(countries), 'days': len(data['days']), 'missingValues': sum(value is None for day in data['days'] for value in day['values']), 'attribution': 'Our World in Data COVID-19 dataset; underlying providers and revisions documented by OWID.', 'licenseURL': 'https://github.com/owid/covid-19-data/blob/master/LICENSE', 'notes': 'Missing observations stay null. Display interpolation applies only between two known daily totals and is not an additional reported observation.'}
destination.with_name('covid-racing.provenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
print(json.dumps(provenance))
