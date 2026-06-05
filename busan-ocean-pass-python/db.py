import os

import psycopg2
import psycopg2.extras
from psycopg2 import extensions
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# 연결 문자열
#   Neon(또는 임의의 PostgreSQL)의 connection string 을 DATABASE_URL 로 지정한다.
#   예) postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/dbname?sslmode=require
# ---------------------------------------------------------------------------
DATABASE_URL = os.getenv('DATABASE_URL') or os.getenv('POSTGRES_URL')

# NUMERIC/DECIMAL(예: AVG(), 평균 평점)을 Python float 로 받아 JSON 직렬화 가능하게 한다.
# (SQLite 의 REAL 결과와 동일한 동작 — Decimal 그대로면 jsonify 에서 터진다)
_DEC2FLOAT = extensions.new_type(
    extensions.DECIMAL.values,
    'DEC2FLOAT',
    lambda value, curs: float(value) if value is not None else None,
)
extensions.register_type(_DEC2FLOAT)

# created_at/verified_at 등 TEXT 타임스탬프 컬럼의 DEFAULT.
# 애플리케이션 코드가 datetime.now()(naive=UTC, Render/Codespace 기준)로 만든
# 문자열과 형식·기준시간을 맞추기 위해 UTC 'YYYY-MM-DD HH24:MI:SS' 로 고정한다.
_NOW = "to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')"

CREATE_TABLES = [
    f"""CREATE TABLE IF NOT EXISTS users (
        id              TEXT PRIMARY KEY,
        nickname        TEXT NOT NULL,
        email           TEXT NOT NULL UNIQUE,
        password_hash   TEXT NOT NULL,
        language        TEXT NOT NULL DEFAULT 'ko' CHECK(language IN ('ko','en','ja','zh')),
        role            TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
        total_stamps    INTEGER NOT NULL DEFAULT 0,
        total_cashback  INTEGER NOT NULL DEFAULT 0,
        is_foreigner    INTEGER NOT NULL DEFAULT 0 CHECK(is_foreigner IN (0,1)),
        created_at      TEXT NOT NULL DEFAULT ({_NOW})
    )""",
    f"""CREATE TABLE IF NOT EXISTS spots (
        id               TEXT PRIMARY KEY,
        name_ko          TEXT NOT NULL,
        name_en          TEXT NOT NULL,
        name_ja          TEXT NOT NULL,
        name_zh          TEXT NOT NULL,
        category         TEXT NOT NULL CHECK(category IN (
                           'beach','port','island','culture','trail','food','hidden'
                         )),
        latitude         DOUBLE PRECISION NOT NULL,
        longitude        DOUBLE PRECISION NOT NULL,
        address          TEXT NOT NULL,
        description_ko   TEXT NOT NULL DEFAULT '',
        description_en   TEXT NOT NULL DEFAULT '',
        image_url        TEXT,
        qr_code          TEXT NOT NULL UNIQUE,
        base_stamp_count INTEGER NOT NULL DEFAULT 1,
        order_in_route   INTEGER NOT NULL DEFAULT 0,
        is_active        INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        created_at       TEXT NOT NULL DEFAULT ({_NOW})
    )""",
    f"""CREATE TABLE IF NOT EXISTS stamp_logs (
        id                  BIGSERIAL PRIMARY KEY,
        user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        spot_id             TEXT REFERENCES spots(id) ON DELETE CASCADE,
        earned_count        INTEGER NOT NULL,
        multiplier          DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        verification_method TEXT NOT NULL DEFAULT 'qr_gps',
        user_lat            DOUBLE PRECISION,
        user_lng            DOUBLE PRECISION,
        verified_at         TEXT NOT NULL DEFAULT ({_NOW})
    )""",
    f"""CREATE TABLE IF NOT EXISTS reviews (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        spot_id           TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
        content           TEXT NOT NULL,
        photo_url         TEXT,
        rating            INTEGER NOT NULL DEFAULT 5 CHECK(rating BETWEEN 1 AND 5),
        language          TEXT NOT NULL DEFAULT 'ko' CHECK(language IN ('ko','en','ja','zh')),
        like_count        INTEGER NOT NULL DEFAULT 0,
        bonus_stamp_given INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL DEFAULT ({_NOW})
    )""",
    f"""CREATE TABLE IF NOT EXISTS rewards (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reward_type TEXT NOT NULL,
        stamp_cost  INTEGER NOT NULL,
        value       INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','used','expired')),
        redeemed_at TEXT NOT NULL DEFAULT ({_NOW})
    )""",
    f"""CREATE TABLE IF NOT EXISTS wiki_posts (
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
        created_at       TEXT NOT NULL DEFAULT ({_NOW})
    )""",
    f"""CREATE TABLE IF NOT EXISTS missions (
        id                TEXT PRIMARY KEY,
        name_ko           TEXT NOT NULL,
        name_en           TEXT NOT NULL,
        description       TEXT NOT NULL DEFAULT '',
        required_spot_ids TEXT NOT NULL DEFAULT '[]',
        bonus_stamps      INTEGER NOT NULL DEFAULT 0,
        bonus_reward      TEXT,
        icon              TEXT NOT NULL DEFAULT '🏖️',
        is_active         INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        created_at        TEXT NOT NULL DEFAULT ({_NOW})
    )""",
    f"""CREATE TABLE IF NOT EXISTS mission_completions (
        id           BIGSERIAL PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mission_id   TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        completed_at TEXT NOT NULL DEFAULT ({_NOW}),
        UNIQUE(user_id, mission_id)
    )""",
    f"""CREATE TABLE IF NOT EXISTS review_likes (
        id         BIGSERIAL PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        review_id  TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT ({_NOW}),
        UNIQUE(user_id, review_id)
    )""",
    f"""CREATE TABLE IF NOT EXISTS wiki_helpful_votes (
        id           BIGSERIAL PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        wiki_post_id TEXT NOT NULL REFERENCES wiki_posts(id) ON DELETE CASCADE,
        created_at   TEXT NOT NULL DEFAULT ({_NOW}),
        UNIQUE(user_id, wiki_post_id)
    )""",
    f"""CREATE TABLE IF NOT EXISTS qr_tokens (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        spot_id     TEXT NOT NULL REFERENCES spots(id) ON DELETE CASCADE,
        expires_at  TEXT NOT NULL,
        used_at     TEXT,
        scanned_by  TEXT REFERENCES users(id),
        created_at  TEXT NOT NULL DEFAULT ({_NOW})
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


def _translate(sql, has_args):
    """SQLite 스타일 SQL 을 psycopg2 가 이해하도록 변환한다.

    - '?'  플레이스홀더 → '%s'
    - 인자가 있는 쿼리의 literal '%' → '%%' (psycopg2 가 % 를 파라미터로 해석하므로)
      ※ 현재 코드베이스의 SQL 본문에는 literal % 가 없어 안전망 용도다.
    """
    if has_args:
        sql = sql.replace('%', '%%')
    return sql.replace('?', '%s')


class _Conn:
    """sqlite3.Connection 과 같은 인터페이스(conn.execute(...).fetchone() 등)를
    제공하는 psycopg2 래퍼. 라우트 코드를 수정하지 않고 그대로 쓰기 위함.

    DictCursor 를 사용하므로 row['col'] 과 row[0] 둘 다 동작하고 dict(row) 도 된다.
    (sqlite3.Row 와 동일)
    """

    def __init__(self, raw):
        self._raw = raw

    def execute(self, sql, args=()):
        cur = self._raw.cursor(cursor_factory=psycopg2.extras.DictCursor)
        if args:
            cur.execute(_translate(sql, True), args)
        else:
            # 인자가 없으면 vars 를 넘기지 않는다. (넘기면 psycopg2 가 SQL 안의
            # literal '%' 를 파라미터로 해석해 IndexError 가 난다 — SQLite 와 다른 점)
            cur.execute(_translate(sql, False))
        return cur

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        self._raw.close()


def _make_conn(path=None):  # path 인자는 기존 시그니처 호환용(무시)
    if not DATABASE_URL:
        raise RuntimeError(
            'DATABASE_URL(또는 POSTGRES_URL) 환경변수가 필요합니다. '
            'Neon 등 PostgreSQL connection string 을 지정하세요.'
        )
    raw = psycopg2.connect(DATABASE_URL)
    return _Conn(raw)


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
    for sql in CREATE_TABLES:
        conn.execute(sql)
    for sql in CREATE_INDEXES:
        conn.execute(sql)
    # 과거 스키마 대비 컬럼 보강 (Postgres 는 IF NOT EXISTS 지원)
    conn.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_tester INTEGER NOT NULL DEFAULT 0')
    conn.commit()
    conn.close()
    print('[DB] 초기화 완료 (PostgreSQL)')


def q_one(conn, sql, args=()):
    row = conn.execute(sql, args).fetchone()
    return dict(row) if row else None


def q_all(conn, sql, args=()):
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def q_run(conn, sql, args=()):
    cur = conn.execute(sql, args)
    conn.commit()
    return cur
