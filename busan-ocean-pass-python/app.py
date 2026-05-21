import os
import uuid
from datetime import datetime

import bcrypt
from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

load_dotenv()

from db import init_db, get_db, close_db, q_one, q_run, _make_conn
from routes.auth     import auth_bp
from routes.spots    import spots_bp
from routes.stamps   import stamps_bp
from routes.reviews  import reviews_bp
from routes.wiki     import wiki_bp
from routes.rewards  import rewards_bp
from routes.missions import missions_bp
from routes.admin    import admin_bp
from routes.qr       import qr_bp


PUBLIC_DIR = os.path.join(os.path.dirname(__file__), '..', 'busan-ocean-pass-backend', 'public')


def create_app():
    app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path='')
    CORS(app, resources={'/*': {'origins': '*'}},
         methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
         allow_headers=['Content-Type', 'Authorization'])

    app.register_blueprint(auth_bp,     url_prefix='/api/auth')
    app.register_blueprint(spots_bp,    url_prefix='/api/spots')
    app.register_blueprint(stamps_bp,   url_prefix='/api/stamps')
    app.register_blueprint(reviews_bp,  url_prefix='/api/reviews')
    app.register_blueprint(wiki_bp,     url_prefix='/api/wiki')
    app.register_blueprint(rewards_bp,  url_prefix='/api/rewards')
    app.register_blueprint(missions_bp, url_prefix='/api/missions')
    app.register_blueprint(admin_bp,    url_prefix='/api/admin')
    app.register_blueprint(qr_bp,       url_prefix='/api/qr')

    app.teardown_appcontext(close_db)

    @app.route('/')
    def index():
        return send_from_directory(PUBLIC_DIR, 'index.html')

    @app.route('/admin.html')
    def admin_page():
        return send_from_directory(PUBLIC_DIR, 'admin.html')

    @app.before_request
    def log_request():
        ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f'[{ts}] {request.method} {request.path}')

    @app.route('/api')
    def api_index():
        return jsonify({
            'success': True,
            'status':  'healthy',
            'server':  '부산오션패스 API v1.0.0 (Python/Flask)',
            'endpoints': {
                'auth': {
                    'POST /api/auth/register': '회원가입',
                    'POST /api/auth/login':    '로그인 (JWT 토큰 발급)',
                    'GET  /api/auth/me':       '내 정보 조회 [🔐]',
                },
                'spots': {
                    'GET /api/spots':                '명소 목록 + 혼잡도 (?lang=ko|en|ja|zh)',
                    'GET /api/spots/nearby':         '주변 명소 (?lat=&lng=&radius=)',
                    'GET /api/spots/:id':            '명소 상세',
                    'GET /api/spots/:id/congestion': '혼잡도 실시간 조회',
                },
                'stamps': {
                    'POST /api/stamps/verify':   '스탬프 인증 (QR + GPS) [🔐]',
                    'GET  /api/stamps/my':        '내 스탬프 내역 [🔐]',
                    'GET  /api/stamps/progress':  '방문 진행률 [🔐]',
                },
                'reviews': {
                    'POST /api/reviews':              '리뷰 작성 [🔐]',
                    'GET  /api/reviews/spot/:spotId': '명소별 리뷰 목록',
                    'POST /api/reviews/:id/like':     '리뷰 좋아요 [🔐]',
                    'GET  /api/reviews/my':           '내 리뷰 목록 [🔐]',
                },
                'wiki': {
                    'POST /api/wiki':             '위키 제보 작성 [🔐]',
                    'GET  /api/wiki':             '승인된 위키 목록',
                    'GET  /api/wiki/my':          '내 제보 목록 [🔐]',
                    'GET  /api/wiki/:id':         '위키 상세 조회',
                    'POST /api/wiki/:id/helpful': '도움됨 투표 [🔐]',
                },
                'rewards': {
                    'GET  /api/rewards/catalog': '리워드 카탈로그 [🔐]',
                    'POST /api/rewards/redeem':  '스탬프 교환 [🔐]',
                    'GET  /api/rewards/my':      '내 교환 내역 [🔐]',
                },
                'missions': {
                    'GET /api/missions':    '미션 목록 + 진행률',
                    'GET /api/missions/my': '완료한 미션 목록 [🔐]',
                },
                'admin': {
                    'GET   /api/admin/wiki/pending': '심사 대기 위키 목록 [🛡️]',
                    'PATCH /api/admin/wiki/:id':     '위키 승인/거절 [🛡️]',
                    'GET   /api/admin/dashboard':    '통계 대시보드 [🛡️]',
                    'GET   /api/admin/users':        '사용자 목록 [🛡️]',
                },
                'qr': {
                    'POST /api/qr/generate': 'QR 토큰 발급 [🔐]',
                    'POST /api/qr/scan':     'QR 스캔 및 스탬프 지급 [🛡️]',
                },
            },
            'legend': {
                '🔐': 'JWT 인증 필요 (Authorization: Bearer <token>)',
                '🛡️': '관리자 전용 (role=admin)',
            },
        })

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({
            'success': False,
            'message': f'요청한 경로를 찾을 수 없습니다: {request.method} {request.path} / Not Found.',
            'hint':    '사용 가능한 엔드포인트 목록: GET /api',
        }), 404

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({'success': False, 'message': '서버 내부 오류가 발생했습니다.'}), 500

    return app


def sync_master_admin():
    master_email    = os.getenv('MASTER_ADMIN_EMAIL', '').strip().lower()
    master_password = os.getenv('MASTER_ADMIN_PASSWORD', '').strip()
    if not master_email or not master_password:
        return

    conn     = _make_conn()
    existing = conn.execute(
        'SELECT id, role FROM users WHERE email = ?', (master_email,)
    ).fetchone()
    pw_hash = bcrypt.hashpw(master_password.encode(), bcrypt.gensalt(10)).decode()

    if not existing:
        user_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO users (id, nickname, email, password_hash, language, role) "
            "VALUES (?, '마스터관리자', ?, ?, 'ko', 'admin')",
            (user_id, master_email, pw_hash)
        )
        print(f'[마스터 어드민] 신규 생성 — {master_email}')
    else:
        conn.execute(
            'UPDATE users SET password_hash = ?, role = ? WHERE email = ?',
            (pw_hash, 'admin', master_email)
        )
        print(f'[마스터 어드민] 동기화 완료 — {master_email}')

    conn.commit()
    conn.close()


if __name__ == '__main__':
    PORT = int(os.getenv('PORT', '3000'))

    print()
    print('========================================')
    print('  부산오션패스 API 서버 (Python/Flask)')
    print('  DB 초기화 중...')

    init_db()
    sync_master_admin()

    app = create_app()

    print(f'  포트: {PORT}')
    print(f'  환경: {os.getenv("FLASK_ENV", "development")}')
    print(f'  헬스체크: http://localhost:{PORT}/api')
    print('========================================')
    print()

    app.run(host='0.0.0.0', port=PORT, debug=os.getenv('FLASK_ENV') != 'production')
