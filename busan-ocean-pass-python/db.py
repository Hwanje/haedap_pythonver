import sqlite3
import os
import pathlib
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.getenv('DB_PATH') or str(
    pathlib.Path(__file__).parent / 'data' / 'busan-ocean-pass.sqlite'
)

CREATE_TABLES = [
    """CREATE TABLE IF NOT EXISTS users (
        id              TEXT PRIMARY KEY,
        nickname        TEXT NOT NULL,
        email           TEXT NOT NULL UNIQUE,
        password_hash   TEXT NOT NULL,
        language        TEXT NOT NULL DEFAULT 'ko' CHECK(language IN ('ko','en','ja','zh')),
        role            TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
        total_stamps    INTEGER NOT NULL DEFAULT 0,
        total_cashback  INTEGER NOT NULL DEFAULT 0,
        is_foreigner    INTEGER NOT NULL DEFAULT 0 CHECK(is_foreigner IN (0,1)),
        created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS spots (
        id               TEXT PRIMARY KEY,
        name_ko          TEXT NOT NULL,
        name_en          TEXT NOT NULL,
        name_ja          TEXT NOT NULL,
        name_zh          TEXT NOT NULL,
        category         TEXT NOT NULL CHECK(category IN (
                           'beach','port','island','culture','trail','food','hidden'
                         )),
        latitude         REAL NOT NULL,
        longitude        REAL NOT NULL,
        address          TEXT NOT NULL,
        description_ko   TEXT NOT NULL DEFAULT '',
        description_en   TEXT NOT NULL DEFAULT '',
        image_url        TEXT,
        qr_code          TEXT NOT NULL UNIQUE,
        base_stamp_count INTEGER NOT NULL DEFAULT 1,
        order_in_route   INTEGER NOT NULL DEFAULT 0,
        is_active        INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS stamp_logs (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        spot_id             TEXT REFERENCES spots(id) ON DELETE CASCADE,
        earned_count        INTEGER NOT NULL,
        multiplier          REAL NOT NULL DEFAULT 1.0,
        verification_method TEXT NOT NULL DEFAULT 'qr_gps',
        user_lat            REAL,
        user_lng            REAL,
        verified_at         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS reviews (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        spot_id           TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
        content           TEXT NOT NULL,
        photo_url         TEXT,
        rating            INTEGER NOT NULL DEFAULT 5 CHECK(rating BETWEEN 1 AND 5),
        language          TEXT NOT NULL DEFAULT 'ko' CHECK(language IN ('ko','en','ja','zh')),
        like_count        INTEGER NOT NULL DEFAULT 0,
        bonus_stamp_given INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS rewards (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reward_type TEXT NOT NULL,
        stamp_cost  INTEGER NOT NULL,
        value       INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','used','expired')),
        redeemed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS wiki_posts (
        id               TEXT PRIMARY KEY,
        user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title            TEXT NOT NULL,
        content          TEXT NOT NULL,
        category         TEXT NOT NULL CHECK(category IN (
                           'event','hidden_spot','safety','tip','food'
                         )),
        spot_id          TEXT REFERENCES spots(id) ON DELETE SET NULL,
        photo_url        TEXT,
        event_start_date TEXT,
        event_end_date   TEXT,
        status           TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
        admin_note       TEXT,
        reviewed_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at      TEXT,
        reward_stamps    INTEGER NOT NULL DEFAULT 0,
        view_count       INTEGER NOT NULL DEFAULT 0,
        helpful_count    INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS missions (
        id                TEXT PRIMARY KEY,
        name_ko           TEXT NOT NULL,
        name_en           TEXT NOT NULL,
        description       TEXT NOT NULL DEFAULT '',
        required_spot_ids TEXT NOT NULL DEFAULT '[]',
        bonus_stamps      INTEGER NOT NULL DEFAULT 0,
        bonus_reward      TEXT,
        icon              TEXT NOT NULL DEFAULT '🏖️',
        is_active         INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
    """CREATE TABLE IF NOT EXISTS mission_completions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mission_id   TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        completed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        UNIQUE(user_id, mission_id)
    )""",
    """CREATE TABLE IF NOT EXISTS review_likes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        review_id  TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        UNIQUE(user_id, review_id)
    )""",
    """CREATE TABLE IF NOT EXISTS wiki_helpful_votes (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        wiki_post_id TEXT NOT NULL REFERENCES wiki_posts(id) ON DELETE CASCADE,
        created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        UNIQUE(user_id, wiki_post_id)
    )""",
    """CREATE TABLE IF NOT EXISTS qr_tokens (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        spot_id     TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
        expires_at  TEXT NOT NULL,
        used_at     TEXT,
        scanned_by  TEXT REFERENCES users(id),
        created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )""",
]

CREATE_INDEXES = [
    'CREATE INDEX IF NOT EXISTS idx_stamp_logs_user_id     ON stamp_logs(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_stamp_logs_spot_id     ON stamp_logs(spot_id)',
    'CREATE INDEX IF NOT EXISTS idx_stamp_logs_verified_at ON stamp_logs(verified_at)',
    'CREATE INDEX IF NOT EXISTS idx_reviews_spot_id        ON reviews(spot_id)',
    'CREATE INDEX IF NOT EXISTS idx_reviews_user_id        ON reviews(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_wiki_posts_status      ON wiki_posts(status)',
    'CREATE INDEX IF NOT EXISTS idx_wiki_posts_category    ON wiki_posts(category)',
    'CREATE INDEX IF NOT EXISTS idx_mission_comp_user_id   ON mission_completions(user_id)',
]


def _make_conn(path=None):
    p = path or DB_PATH
    os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
    conn = sqlite3.connect(p)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def get_db():
    from flask import g
    if 'db' not in g:
        g.db = _make_conn()
    return g.db


def close_db(e=None):
    from flask import g
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    conn = _make_conn()
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    for sql in CREATE_TABLES:
        conn.execute(sql)
    for sql in CREATE_INDEXES:
        conn.execute(sql)
    try:
        conn.execute('ALTER TABLE users ADD COLUMN is_tester INTEGER NOT NULL DEFAULT 0')
    except Exception:
        pass
    conn.commit()
    conn.close()
    print(f'[DB] 초기화 완료: {DB_PATH}')


def q_one(conn, sql, args=()):
    row = conn.execute(sql, args).fetchone()
    return dict(row) if row else None


def q_all(conn, sql, args=()):
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def q_run(conn, sql, args=()):
    cur = conn.execute(sql, args)
    conn.commit()
    return cur
