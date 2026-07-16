#!/usr/bin/env python3
"""BogHopper server — static game files + usage analytics.

Stdlib only (no pip installs). Serves the game, records lightweight
usage events into SQLite, and exposes a dashboard:

    GET  /               the game
    POST /api/event      beacon from the game: {"type": "visit"|"start"|"over", "dist": int}
    GET  /api/stats      aggregates for the dashboard (?days=7|30|90)
    GET  /dashboard      usage dashboard (hidden-but-public)

Run:  python3 server.py            (PORT and BOG_DB env vars optional)
"""
import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get('BOG_DB', os.path.join(ROOT, 'boghopper.db'))
PORT = int(os.environ.get('PORT', '8080'))
SALT = None

_local = threading.local()


def db():
    if not hasattr(_local, 'conn'):
        _local.conn = sqlite3.connect(DB_PATH)
        _local.conn.execute('PRAGMA journal_mode=WAL')
    return _local.conn


def init_db():
    global SALT
    c = sqlite3.connect(DB_PATH)
    c.execute('''CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        dist INTEGER,
        visitor TEXT)''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)')
    c.execute('''CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY,
        ts INTEGER NOT NULL,
        name TEXT NOT NULL,
        dist INTEGER NOT NULL)''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_scores_dist ON scores(dist DESC)')
    c.execute('''CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_name
                 ON scores(name COLLATE NOCASE)''')
    c.execute('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)')
    if not c.execute("SELECT v FROM meta WHERE k='salt'").fetchone():
        c.execute("INSERT INTO meta VALUES ('salt', ?)", (secrets.token_hex(16),))
    c.commit()
    SALT = c.execute("SELECT v FROM meta WHERE k='salt'").fetchone()[0]
    c.close()


def local_midnight(now):
    lt = time.localtime(now)
    return time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1))


def stats(query):
    try:
        days = max(1, min(int(query.get('days', ['30'])[0]), 365))
    except ValueError:
        days = 30
    now = time.time()
    midnight = local_midnight(now)
    since = midnight - (days - 1) * 86400
    c = db()

    rows = c.execute('''
        SELECT date(ts, 'unixepoch', 'localtime') AS d,
               COUNT(DISTINCT visitor),
               SUM(type = 'start'),
               MAX(CASE WHEN type = 'over' THEN dist END)
        FROM events WHERE ts >= ? GROUP BY d''', (since,)).fetchall()
    by_day = {r[0]: r for r in rows}
    daily = []
    for i in range(days):
        key = time.strftime('%Y-%m-%d', time.localtime(since + i * 86400 + 3600))
        r = by_day.get(key)
        daily.append({
            'day': key,
            'players': r[1] if r else 0,
            'runs': (r[2] or 0) if r else 0,
            'best': r[3] if r and r[3] is not None else None,
        })

    # finish-distance histogram, 250 m bins, last bin is 2750 m+
    hist = [0] * 12
    for b, n in c.execute('''
            SELECT MIN(dist / 250, 11), COUNT(*) FROM events
            WHERE type = 'over' AND dist IS NOT NULL AND ts >= ?
            GROUP BY 1''', (since,)).fetchall():
        hist[int(b)] = n

    recent = [{'ts': r[0], 'dist': r[1]} for r in c.execute('''
        SELECT ts, dist FROM events
        WHERE type = 'over' AND dist IS NOT NULL
        ORDER BY ts DESC LIMIT 12''').fetchall()]

    range_tot = c.execute('''
        SELECT SUM(type = 'start'), COUNT(DISTINCT visitor),
               MAX(CASE WHEN type = 'over' THEN dist END)
        FROM events WHERE ts >= ?''', (since,)).fetchone()
    today = c.execute('''
        SELECT SUM(type = 'start'), COUNT(DISTINCT visitor)
        FROM events WHERE ts >= ?''', (midnight,)).fetchone()

    return {
        'days': days,
        'daily': daily,
        'hist': hist,
        'histBin': 250,
        'recent': recent,
        'kpi': {
            'runsToday': today[0] or 0,
            'playersToday': today[1] or 0,
            'runsRange': range_tot[0] or 0,
            'playersRange': range_tot[1] or 0,
            'bestRange': range_tot[2],
        },
    }


def leaderboard(query):
    c = db()
    top = [{'rank': i + 1, 'id': r[0], 'name': r[1], 'dist': r[2]}
           for i, r in enumerate(c.execute(
               'SELECT id, name, dist FROM scores ORDER BY dist DESC, id ASC LIMIT 10'
           ).fetchall())]
    me = None
    try:
        me_id = int(query.get('me', [''])[0])
    except (ValueError, IndexError):
        me_id = None
    if me_id is not None and not any(r['id'] == me_id for r in top):
        row = c.execute('SELECT id, name, dist FROM scores WHERE id = ?',
                        (me_id,)).fetchone()
        if row:
            # earlier submission wins ties
            rank = c.execute(
                'SELECT COUNT(*) FROM scores WHERE dist > ? OR (dist = ? AND id < ?)',
                (row[2], row[2], row[0])).fetchone()[0] + 1
            me = {'rank': rank, 'id': row[0], 'name': row[1], 'dist': row[2]}
    return {'top': top, 'me': me}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, *args):
        pass

    def send_json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/dashboard':
            self.path = '/dashboard.html'
            return super().do_GET()
        if path == '/leaderboard':
            self.path = '/leaderboard.html'
            return super().do_GET()
        if path == '/api/stats':
            return self.send_json(stats(parse_qs(urlparse(self.path).query)))
        if path == '/api/leaderboard':
            return self.send_json(leaderboard(parse_qs(urlparse(self.path).query)))
        if path == '/boghopper.db' or path.startswith('/boghopper.db-'):
            return self.send_error(404)  # never serve the database
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == '/api/score':
            try:
                length = min(int(self.headers.get('Content-Length', 0)), 4096)
                data = json.loads(self.rfile.read(length) or b'{}')
                name = str(data.get('name', '')).strip()[:24]
                if not name:
                    raise ValueError('empty name')
                dist = max(0, min(int(data.get('dist')), 1_000_000))
                # one entry per name: keep only the highest score
                c = db()
                row = c.execute(
                    'SELECT id, dist FROM scores WHERE name = ? COLLATE NOCASE',
                    (name,)).fetchone()
                if row and row[1] >= dist:
                    return self.send_json({'ok': True, 'id': row[0], 'improved': False})
                if row:
                    c.execute('UPDATE scores SET dist = ?, ts = ?, name = ? WHERE id = ?',
                              (dist, int(time.time()), name, row[0]))
                    c.commit()
                    return self.send_json({'ok': True, 'id': row[0], 'improved': True})
                cur = c.execute(
                    'INSERT INTO scores (ts, name, dist) VALUES (?, ?, ?)',
                    (int(time.time()), name, dist))
                c.commit()
                return self.send_json({'ok': True, 'id': cur.lastrowid, 'improved': True})
            except Exception:
                return self.send_error(400)
        if path != '/api/event':
            return self.send_error(404)
        try:
            length = min(int(self.headers.get('Content-Length', 0)), 4096)
            data = json.loads(self.rfile.read(length) or b'{}')
            etype = data.get('type')
            if etype not in ('visit', 'start', 'over'):
                raise ValueError(etype)
            dist = data.get('dist')
            dist = max(0, min(int(dist), 1_000_000)) if dist is not None else None
            # daily-rotating salted hash: counts uniques without storing IPs
            ip = self.headers.get('X-Forwarded-For',
                                  self.client_address[0]).split(',')[0].strip()
            ua = self.headers.get('User-Agent', '')[:200]
            day = time.strftime('%Y%m%d')
            visitor = hashlib.sha256(
                f'{SALT}|{ip}|{ua}|{day}'.encode()).hexdigest()[:16]
            db().execute(
                'INSERT INTO events (ts, type, dist, visitor) VALUES (?, ?, ?, ?)',
                (int(time.time()), etype, dist, visitor))
            db().commit()
            self.send_json({'ok': True})
        except Exception:
            self.send_error(400)


if __name__ == '__main__':
    init_db()
    print(f'BogHopper serving on http://0.0.0.0:{PORT}  (db: {DB_PATH})')
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
