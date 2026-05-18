/**
 * database.js — SQLite 데이터베이스 초기화 모듈
 *
 * 우선 순위:
 *   1. better-sqlite3 (동기식 네이티브 바인딩, 빠름)
 *   2. sql.js (순수 JS WebAssembly 빌드, Replit에서 빌드 실패 시 fallback)
 *
 * 테이블은 모두 CREATE TABLE IF NOT EXISTS로 작성해
 * 서버 재시작 시 중복 생성 오류 없이 멱등성을 보장합니다.
 *
 * 내보내기:
 *   module.exports = db    — 래퍼 객체 (prepare/exec/transaction/close)
 *   db.ready               — DB 초기화 완료 Promise (sql.js 모드에서 활용)
 *   db.usingFallback       — sql.js 사용 여부 (boolean)
 *   db.DB_PATH             — DB 파일 경로
 *
 * 사용 방법 (server.js, seed.js):
 *   const db = require('./database');
 *   await db.ready; // sql.js 초기화 대기 (better-sqlite3는 즉시 해소)
 *   // 이후 db.prepare(...).get/all/run() 사용
 *
 * 라우트 모듈(routes/*.js):
 *   const db = require('../db/database');
 *   // 요청 핸들러 실행 시점에는 이미 초기화 완료 상태이므로 바로 사용 가능
 */

'use strict';

const path = require('path');
const fs   = require('fs');
require('dotenv').config();

// ──────────────────────────────────────────────
// DB 파일 경로 결정
// ──────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '../../data/busan-ocean-pass.sqlite');

// data/ 디렉토리가 없으면 자동 생성
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ──────────────────────────────────────────────
// 테이블 DDL 정의
// ──────────────────────────────────────────────

const CREATE_TABLES_SQL = [
  // ─── 1. users ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
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
  )`,

  // ─── 2. spots ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS spots (
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
  )`,

  // ─── 3. stamp_logs ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS stamp_logs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    spot_id             TEXT REFERENCES spots(id) ON DELETE CASCADE,
    earned_count        INTEGER NOT NULL,
    multiplier          REAL NOT NULL DEFAULT 1.0,
    verification_method TEXT NOT NULL DEFAULT 'qr_gps',
    user_lat            REAL,
    user_lng            REAL,
    verified_at         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,

  // ─── 4. reviews ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS reviews (
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
  )`,

  // ─── 5. rewards ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS rewards (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reward_type TEXT NOT NULL,
    stamp_cost  INTEGER NOT NULL,
    value       INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','used','expired')),
    redeemed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`,

  // ─── 6. wiki_posts ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS wiki_posts (
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
  )`,

  // ─── 7. missions ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS missions (
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
  )`,

  // ─── 8. mission_completions ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mission_completions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mission_id   TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    completed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, mission_id)
  )`,

  // ─── 9. review_likes ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS review_likes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    review_id  TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, review_id)
  )`,

  // ─── 10. wiki_helpful_votes ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS wiki_helpful_votes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wiki_post_id TEXT NOT NULL REFERENCES wiki_posts(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, wiki_post_id)
  )`,
];

const CREATE_INDEXES_SQL = [
  'CREATE INDEX IF NOT EXISTS idx_stamp_logs_user_id     ON stamp_logs(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_stamp_logs_spot_id     ON stamp_logs(spot_id)',
  'CREATE INDEX IF NOT EXISTS idx_stamp_logs_verified_at ON stamp_logs(verified_at)',
  'CREATE INDEX IF NOT EXISTS idx_reviews_spot_id        ON reviews(spot_id)',
  'CREATE INDEX IF NOT EXISTS idx_reviews_user_id        ON reviews(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_wiki_posts_status      ON wiki_posts(status)',
  'CREATE INDEX IF NOT EXISTS idx_wiki_posts_category    ON wiki_posts(category)',
  'CREATE INDEX IF NOT EXISTS idx_mission_comp_user_id   ON mission_completions(user_id)',
];

// ──────────────────────────────────────────────
// sql.js → better-sqlite3 호환 래퍼
// ──────────────────────────────────────────────

/**
 * sql.js Database를 better-sqlite3 스타일로 래핑합니다.
 * prepare().run(), prepare().get(), prepare().all() 패턴을 지원합니다.
 *
 * @param {Object} sqlJsDb - sql.js Database 인스턴스
 * @returns {Object} better-sqlite3 호환 래퍼 객체
 */
function createSqlJsWrapper(sqlJsDb) {
  const wrapper = {
    _db:    sqlJsDb,
    _dirty: false,

    /** PRAGMA 또는 단순 SQL을 직접 실행 */
    exec(sql) {
      sqlJsDb.run(sql);
      this._dirty = true;
    },

    /** SQL 구문을 준비하고 better-sqlite3 호환 Statement 객체를 반환합니다. */
    prepare(sql) {
      return {
        /** INSERT / UPDATE / DELETE */
        run(...params) {
          const flatParams = params.flat();
          sqlJsDb.run(sql, flatParams);
          wrapper._dirty = true;
          return { changes: 1, lastInsertRowid: 0 };
        },

        /** SELECT — 첫 번째 행 */
        get(...params) {
          const flatParams = params.flat();
          const result = sqlJsDb.exec(sql, flatParams);
          if (!result.length || !result[0].values.length) return undefined;
          const { columns, values } = result[0];
          return Object.fromEntries(columns.map((col, i) => [col, values[0][i]]));
        },

        /** SELECT — 모든 행 */
        all(...params) {
          const flatParams = params.flat();
          const result = sqlJsDb.exec(sql, flatParams);
          if (!result.length) return [];
          const { columns, values } = result[0];
          return values.map(row =>
            Object.fromEntries(columns.map((col, i) => [col, row[i]]))
          );
        },
      };
    },

    /** 트랜잭션 래퍼 (better-sqlite3 transaction() 호환) */
    transaction(fn) {
      return (...args) => {
        sqlJsDb.run('BEGIN');
        try {
          const result = fn(...args);
          sqlJsDb.run('COMMIT');
          wrapper._dirty = true;
          return result;
        } catch (err) {
          sqlJsDb.run('ROLLBACK');
          throw err;
        }
      };
    },

    /** DB를 파일로 저장 (sql.js 전용) */
    saveToFile() {
      if (!this._dirty) return;
      try {
        const data = sqlJsDb.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
        this._dirty = false;
        console.log('[DB] sql.js — 디스크에 저장 완료:', DB_PATH);
      } catch (err) {
        console.warn('[DB] sql.js — 디스크 저장 실패:', err.message);
      }
    },

    /** DB 연결 종료 */
    close() {
      this.saveToFile();
      sqlJsDb.close();
    },
  };

  // 프로세스 종료 시 자동 저장
  process.on('exit', () => wrapper.saveToFile());

  return wrapper;
}

// ──────────────────────────────────────────────
// 공통 스키마 적용
// ──────────────────────────────────────────────

function applySchema(dbInstance) {
  // WAL 및 외래키 설정
  try { dbInstance.exec('PRAGMA journal_mode = WAL'); } catch (_) { /* sql.js 무시 */ }
  try { dbInstance.exec('PRAGMA foreign_keys = ON');  } catch (_) { /* sql.js 무시 */ }
  try { dbInstance.exec('PRAGMA synchronous = NORMAL'); } catch (_) { /* sql.js 무시 */ }

  for (const sql of CREATE_TABLES_SQL)  { dbInstance.exec(sql); }
  for (const sql of CREATE_INDEXES_SQL) { dbInstance.exec(sql); }
}

// ──────────────────────────────────────────────
// 공유 래퍼 객체
//
// module.exports는 이 단일 객체입니다.
// better-sqlite3 초기화 시: 내부 _db에 실제 DB 인스턴스 바로 설정
// sql.js 초기화 시: ready Promise 해소 후 _db 설정
//
// 라우트 모듈은 const db = require('../db/database') 로 이 객체를 받습니다.
// 요청 핸들러는 서버 시작(await ready) 이후에 실행되므로 _db가 보장됩니다.
// ──────────────────────────────────────────────

const sharedDb = {
  _db:           null,  // 실제 DB 인스턴스 (초기화 후 설정)
  usingFallback: false,
  DB_PATH,

  // ── better-sqlite3 인터페이스 위임 ──────────────────────────────────

  exec(sql) {
    if (!this._db) throw new Error('[DB] 초기화 전 exec 호출');
    return this._db.exec(sql);
  },

  prepare(sql) {
    if (!this._db) throw new Error('[DB] 초기화 전 prepare 호출');
    return this._db.prepare(sql);
  },

  transaction(fn) {
    if (!this._db) throw new Error('[DB] 초기화 전 transaction 호출');
    return this._db.transaction(fn);
  },

  close() {
    if (!this._db) return;
    return this._db.close();
  },

  // sql.js 전용
  saveToFile() {
    if (this._db && typeof this._db.saveToFile === 'function') {
      this._db.saveToFile();
    }
  },
};

// ──────────────────────────────────────────────
// 초기화 실행
// ──────────────────────────────────────────────

/**
 * better-sqlite3를 동기적으로 로드합니다.
 * 성공 시 true, 실패 시 false 반환.
 */
function tryLoadBetterSqlite3() {
  try {
    const Database = require('better-sqlite3');
    const rawDb    = new Database(DB_PATH, { verbose: null });
    applySchema({ exec: (sql) => rawDb.exec(sql) });
    sharedDb._db = rawDb;
    console.log('[DB] better-sqlite3 모드로 초기화 완료:', DB_PATH);
    return true;
  } catch (err) {
    console.warn('[DB] better-sqlite3 로드 실패 — sql.js로 대체합니다.');
    console.warn('[DB] 실패 이유:', err.message);
    return false;
  }
}

/**
 * sql.js를 비동기적으로 로드합니다.
 */
async function loadSqlJs() {
  const wasmPath   = require.resolve('sql.js/dist/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  const initSqlJs  = require('sql.js/dist/sql-wasm.js');

  const SQL = await initSqlJs({ wasmBinary });

  let sqlJsDb;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    sqlJsDb = new SQL.Database(fileBuffer);
    console.log('[DB] sql.js — 기존 DB 파일 로드:', DB_PATH);
  } else {
    sqlJsDb = new SQL.Database();
    console.log('[DB] sql.js — 새 인메모리 DB 생성 (파일로 영속화 예정)');
  }

  const wrapper = createSqlJsWrapper(sqlJsDb);
  applySchema(wrapper);
  console.log('[DB] sql.js 모드로 초기화 완료 (Replit 환경)');
  return wrapper;
}

// 초기화 및 ready Promise 설정
const betterOk = tryLoadBetterSqlite3();

/**
 * DB 초기화 완료를 알리는 Promise.
 * better-sqlite3 모드에서는 즉시 해소됩니다.
 * sql.js 모드에서는 wasm 로드 완료 후 해소됩니다.
 *
 * server.js / seed.js에서 반드시 await 해야 합니다:
 *   await db.ready;
 */
sharedDb.ready = betterOk
  ? Promise.resolve(sharedDb)
  : loadSqlJs().then(wrapper => {
      sharedDb._db           = wrapper;
      sharedDb.usingFallback = true;
      // saveToFile 위임도 업데이트
      return sharedDb;
    }).catch(err => {
      console.error('[DB] sql.js 로드도 실패했습니다:', err.message);
      console.error('[DB] 해결 방법: npm install 을 다시 실행하거나 README의 트러블슈팅을 참고하세요.');
      process.exit(1);
    });

// ──────────────────────────────────────────────
// 내보내기
// ──────────────────────────────────────────────

module.exports = sharedDb;
