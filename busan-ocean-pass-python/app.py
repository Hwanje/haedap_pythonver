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
from routes.chat     import chat_bp


PUBLIC_DIR = os.path.join(os.path.dirname(__file__), 'public')


def create_app():
    app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path='')
    app.url_map.strict_slashes = False
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
    app.register_blueprint(chat_bp,     url_prefix='/api/chat')

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


def seed_spots():
    spots = [
        ('QR_SPOT_01', '해운대해수욕장', 'Haeundae Beach', '海雲台海水浴場', '海云台海水浴场', 'beach', 35.1587, 129.1604, '부산광역시 해운대구 우동', '부산을 대표하는 해수욕장으로, 여름이면 수백만 명이 찾는 국내 최대 규모의 해변입니다. 백사장 길이 1.5km, 광안대교와 마린시티의 스카이라인이 어우러진 절경을 자랑합니다.', 'The most famous beach in Busan, attracting millions of visitors every summer. A 1.5km white sand beach with stunning views of Gwangan Bridge and Marine City skyline.', 1, 1),
        ('QR_SPOT_02', '송정해수욕장', 'Songjeong Beach', '松亭海水浴場', '松亭海水浴场', 'beach', 35.1790, 129.2003, '부산광역시 해운대구 송정동', '해운대보다 한적한 분위기의 해변으로, 서핑과 윈드서핑의 성지로 알려진 곳입니다. 소나무 숲과 어우러진 자연 그대로의 해변 경관을 감상할 수 있습니다.', 'A quieter beach than Haeundae, known as a surfing and windsurfing paradise. Enjoy natural beach scenery surrounded by pine forests.', 1, 2),
        ('QR_SPOT_03', '광안리해수욕장', 'Gwangalli Beach', '広安里海水浴場', '广安里海水浴场', 'beach', 35.1531, 129.1184, '부산광역시 수영구 광안해변로', '광안대교 야경으로 유명한 해변으로, 밤이 되면 형형색색의 조명으로 수놓인 대교가 해변과 어우러져 환상적인 풍경을 연출합니다.', "Famous for the night view of Gwangan Bridge. After dark, the bridge lights up in spectacular colors, creating a fantastic waterfront scene.", 1, 3),
        ('QR_SPOT_04', '송도해수욕장', 'Songdo Beach', '松島海水浴場', '松岛海水浴场', 'beach', 35.0785, 129.0197, '부산광역시 서구 암남동', '부산 최초의 공설해수욕장으로 100년 이상의 역사를 지닌 곳입니다. 해상케이블카와 구름다리가 명물이며, 서쪽 해안의 아름다운 암남공원과 이어집니다.', "Busan's first public beach with over 100 years of history. Famous for its ocean cable car and sky bridge.", 1, 4),
        ('QR_SPOT_05', '다대포해수욕장', 'Dadaepo Beach', '多大浦海水浴場', '多大浦海水浴场', 'beach', 35.0452, 128.9617, '부산광역시 사하구 다대동', '국내 최대 규모의 낙조 분수와 넓은 백사장이 특징인 해변입니다. 특히 해질 무렵 낙동강 하구와 어우러지는 일몰 풍경은 부산 최고의 석양으로 손꼽힙니다.', 'A beach featuring the largest sunset fountain in Korea and wide sandy shores.', 1, 5),
        ('QR_SPOT_06', '자갈치시장', 'Jagalchi Market', 'チャガルチ市場', '札嘎其市场', 'port', 35.0970, 129.0303, '부산광역시 중구 자갈치해안로', "\'아지매\'로 유명한 우리나라 최대 수산시장입니다. 싱싱한 해산물을 저렴하게 즐길 수 있으며, 2층 전망대에서 부산항과 영도의 파노라마 뷰를 감상할 수 있습니다.", "Korea's largest seafood market, famous for its female vendors (ajimae). Enjoy fresh seafood at affordable prices.", 1, 6),
        ('QR_SPOT_07', '국제시장', 'Gukje Market', '国際市場', '国际市场', 'port', 35.0997, 129.0271, '부산광역시 중구 신창동', "6.25전쟁 당시 피난민들이 생계를 위해 만든 역사적인 시장입니다. 영화 \'국제시장\'의 배경지로 유명하며, 전통과 현대가 공존하는 부산 원도심 문화의 중심입니다.", "A historic market created by wartime refugees during the Korean War. Famous as the setting for the movie 'Gukje Market.'", 1, 7),
        ('QR_SPOT_08', '부산항국제여객터미널', 'Busan Port International Ferry Terminal', '釜山港国際旅客ターミナル', '釜山港国际客运站', 'port', 35.1075, 129.0385, '부산광역시 동구 중앙대로', '일본 시모노세키, 후쿠오카, 쓰시마 등으로 향하는 국제 여객선이 출발하는 터미널입니다.', 'The departure terminal for international ferries to Shimonoseki, Fukuoka, and Tsushima in Japan.', 1, 8),
        ('QR_SPOT_09', '영도대교', 'Yeongdo Bridge', '影島大橋', '影岛大桥', 'port', 35.0963, 129.0340, '부산광역시 중구 대교로', '1934년 건설된 우리나라 최초의 도개교로, 매일 오후 2시에 다리가 들어올려지는 장면이 유명합니다.', "Korea's first drawbridge, built in 1934. Famous for its daily 2pm bridge-lifting ceremony.", 1, 9),
        ('QR_SPOT_10', '오륙도', 'Oryukdo Island', '五六島', '五六岛', 'island', 35.0784, 129.1327, '부산광역시 남구 용호동', '조수에 따라 5개 또는 6개로 보이는 신비로운 섬입니다. 동해와 남해가 나뉘는 지점에 위치하여 해양 생태계가 풍부하며, 일출 명소로도 유명합니다.', 'A mysterious island cluster that appears as 5 or 6 islands depending on the tide.', 1, 10),
        ('QR_SPOT_11', '태종대', 'Taejongdae', '太宗台', '太宗台', 'island', 35.0561, 129.0852, '부산광역시 영도구 동삼동', '신라 태종 무열왕이 전국의 명궁들과 활쏘기를 즐겼다는 절경의 명소입니다. 파도가 만든 기암절벽과 망부석 전설, 전망대에서 보이는 대마도 풍경이 인상적입니다.', 'A scenic spot where Silla King Taejong reportedly enjoyed archery. Impressive rocky cliffs and views of Tsushima Island.', 1, 11),
        ('QR_SPOT_12', '영도등대', 'Yeongdo Lighthouse', '影島灯台', '影岛灯塔', 'island', 35.0510, 129.0747, '부산광역시 영도구 동삼동', '1906년 처음 불을 밝힌 100년 이상의 역사를 가진 등대입니다. 붉은 벽돌 외관이 아름다우며, 등대 아래로 펼쳐지는 남해 풍경이 탁월합니다.', 'A lighthouse first lit in 1906 with over 100 years of history. Features beautiful red brick architecture.', 1, 12),
        ('QR_SPOT_13', '이기대공원', 'Igidae Park', '二妓台公園', '二妓台公园', 'island', 35.1018, 129.1217, '부산광역시 남구 용호동', '부산 남구 해안에 위치한 자연공원으로, 기암괴석과 해식절벽이 어우러진 절경을 자랑합니다.', "A natural park on the coast of Busan's Nam-gu, featuring spectacular rocky cliffs and sea-eroded formations.", 1, 13),
        ('QR_SPOT_14', '국립해양박물관', 'National Maritime Museum', '国立海洋博物館', '国立海洋博物馆', 'culture', 35.0697, 129.0815, '부산광역시 영도구 해양로', '우리나라 최초의 국립 해양 전문 박물관으로, 해양 역사와 문화를 총망라한 전시를 선보입니다.', "Korea's first national maritime museum, showcasing comprehensive exhibitions on maritime history and culture.", 1, 14),
        ('QR_SPOT_15', '부산아쿠아리움', 'Busan Aquarium', '釜山アクアリウム', '釜山水族馆', 'culture', 35.1579, 129.1610, '부산광역시 해운대구 해운대해변로', '해운대 해변에 위치한 국내 최대 수족관입니다. 250여 종 35,000여 마리의 해양생물이 전시되며, 80m 해저 터널을 걸으며 상어와 가오리를 가까이서 관찰할 수 있습니다.', 'The largest aquarium in Korea, located on Haeundae Beach. Walk through an 80m underwater tunnel and observe sharks and rays.', 1, 15),
        ('QR_SPOT_16', '송도해상케이블카', 'Songdo Ocean Cable Car', '松島海上ケーブルカー', '松岛海上缆车', 'culture', 35.0805, 129.0183, '부산광역시 서구 암남동', "우리나라 최초의 해상 케이블카로, 바다 위를 가로질러 해안 절경을 조망합니다.", "Korea's first ocean cable car, crossing over the sea with spectacular coastal views.", 1, 16),
        ('QR_SPOT_17', '갈맷길1코스', 'Galmaetgil Course 1', 'カルメッキル1コース', '加尔梅路1号线', 'trail', 35.1790, 129.2005, '부산광역시 기장군 기장읍 일원', '부산의 대표 도보 여행길인 갈맷길의 첫 번째 코스입니다. 기장군 해안을 따라 걷는 이 코스는 청정 해양 경관과 어촌 마을의 정취를 동시에 즐길 수 있습니다.', "The first course of Galmaetgil, Busan's signature walking trail.", 1, 17),
        ('QR_SPOT_18', '이기대해안산책로', 'Igidae Coastal Trail', '二妓台海岸遊歩道', '二妓台海岸步道', 'trail', 35.1001, 129.1250, '부산광역시 남구 용호동', '이기대 자연공원을 따라 이어지는 해안 산책로로, 기암괴석과 에메랄드빛 바다가 어우러진 아름다운 트레킹 코스입니다.', 'A coastal trail along Igidae Natural Park, offering beautiful trekking through rocky formations and emerald waters.', 1, 18),
        ('QR_SPOT_19', '청사포다릿돌전망대', 'Cheongsapo Stepping Stone Observatory', '青沙浦踏み石展望台', '青沙浦垫脚石观景台', 'trail', 35.1706, 129.2007, '부산광역시 해운대구 청사포로', '청사포 해안 절벽 위에 설치된 투명 유리 전망대입니다. 동해 바다 위에 떠있는 듯한 아찔한 경험을 선사합니다.', 'A transparent glass observatory perched on the cliff above Cheongsapo coast.', 1, 19),
        ('QR_SPOT_20', '흰여울문화마을', 'Huinnyeoul Culture Village', 'フィンヨウル文化村', '白浪文化村', 'trail', 35.0839, 129.0222, '부산광역시 영도구 절영로', "절영도 해안 절벽을 따라 형성된 감성 문화마을입니다. 한국판 산토리니로 불리며, 좁은 골목길과 알록달록한 집들이 그림 같은 풍경을 연출합니다.", "Known as Korea's Santorini, with picturesque narrow alleyways and colorful houses.", 1, 20),
        ('QR_SPOT_21', '기장시장', 'Gijang Market', '機張市場', '机张市场', 'food', 35.2441, 129.2135, '부산광역시 기장군 기장읍', '기장 멸치, 미역, 해산물로 유명한 전통 재래시장입니다. 특히 봄철 기장 멸치젓은 전국적으로 유명합니다.', 'A traditional market famous for Gijang anchovies, seaweed, and seafood.', 1, 21),
        ('QR_SPOT_22', '민락회타운', 'Millak Raw Fish Town', '民楽フェタウン', '民乐生鱼片街', 'food', 35.1542, 129.1290, '부산광역시 수영구 민락동', '광안리 인근에 위치한 부산 최대의 횟집 거리입니다. 광안대교 야경을 감상하며 식사하는 것이 매력입니다.', 'The largest raw fish restaurant street in Busan, near Gwangalli Beach.', 1, 22),
        ('QR_SPOT_23', '송정활어회센터', 'Songjeong Live Fish Center', '松亭活魚刺身センター', '松亭活鱼生鱼片中心', 'food', 35.1795, 129.2010, '부산광역시 해운대구 송정동', '송정 어촌계에서 운영하는 활어회 전문 단지입니다. 인근 어항에서 갓 잡아 올린 신선한 해산물을 합리적인 가격에 즐길 수 있습니다.', 'A live seafood complex operated by Songjeong fishing cooperative.', 1, 23),
        ('QR_SPOT_24', '청학배수지전망대', 'Cheonghak Reservoir Observatory', '青鶴貯水池展望台', '青鹤水库观景台', 'hidden', 35.0891, 129.0391, '부산광역시 영도구 청학동', '영도 주민들이 즐겨 찾는 숨은 야경 명소입니다. 부산항 전경과 남항대교, 영도 야경이 한눈에 펼쳐집니다.', 'A hidden night view spot popular with Yeongdo locals. Panoramic views of Busan Port and Namhang Bridge.', 1, 24),
        ('QR_SPOT_25', '아미산전망대', 'Amisan Observatory', '峨眉山展望台', '峨眉山观景台', 'hidden', 35.0872, 129.0199, '부산광역시 서구 서대신동', '감천문화마을 인근 아미산에 위치한 전망대입니다. 감천항과 송도 해변, 다대포 방향의 탁 트인 바다 전망을 자랑합니다.', 'An observatory on Amisan Mountain near Gamcheon Culture Village.', 1, 25),
        ('QR_SPOT_26', '두무진해안', 'Dumujin Coast', '豆無津海岸', '豆无津海岸', 'hidden', 35.0490, 128.9760, '부산광역시 사하구 다대동', '다대포 인근의 숨겨진 해안으로, 기암괴석과 청정한 바다가 어우러진 비경을 자랑합니다.', 'A hidden coastal gem near Dadaepo, featuring dramatic rock formations and pristine waters.', 1, 26),
        ('QR_SPOT_27', '동백섬', 'Dongbaek Island', '冬柏島', '冬柏岛', 'hidden', 35.1567, 129.1571, '부산광역시 해운대구 동백로', '육지와 연결된 작은 반도형 섬으로, 동백나무 군락지로 유명합니다. 누리마루 APEC하우스가 위치하며, 해운대 전망 산책로가 인기입니다.', 'A small peninsula connected to land, famous for its winter camellia groves and the Nurimaru APEC House.', 1, 27),
        ('QR_SPOT_28', '청사포항구', 'Cheongsapo Harbor', '青沙浦港', '青沙浦港口', 'hidden', 35.1698, 129.2010, '부산광역시 해운대구 청사포로', '아담한 어촌 항구로, 해녀들의 물질 작업과 어부들의 생업을 가까이에서 볼 수 있는 곳입니다.', 'A small fishing harbor where you can watch haenyeo at work and fishermen going about their daily lives.', 1, 28),
        ('QR_SPOT_29', '암남공원', 'Amnam Park', '岩南公園', '岩南公园', 'hidden', 35.0765, 129.0145, '부산광역시 서구 암남동', '송도 서쪽 끝 암반 지형에 조성된 자연공원입니다. 잘 정비된 탐방로를 따라 기암절벽과 남해의 절경을 감상할 수 있습니다.', 'A natural park built on rocky terrain at the western end of Songdo.', 1, 29),
        ('QR_SPOT_30', '몰운대', 'Morundae', '没雲台', '没云台', 'hidden', 35.0447, 128.9607, '부산광역시 사하구 다대동', '낙동강 하구와 남해가 만나는 지점의 아름다운 곶입니다. 안개와 구름이 자아내는 신비로운 풍경으로 유명합니다.', "A beautiful promontory where the Nakdong River estuary meets the South Sea. Famous for its mystical fog and cloud scenery.", 1, 30),
    ]
    conn = _make_conn()
    inserted = 0
    for s in spots:
        qr_code = s[0]
        existing = conn.execute('SELECT id FROM spots WHERE qr_code = ?', (qr_code,)).fetchone()
        if not existing:
            spot_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO spots (id, qr_code, name_ko, name_en, name_ja, name_zh, category, "
                "latitude, longitude, address, description_ko, description_en, base_stamp_count, order_in_route) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (spot_id, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], s[10], s[11], s[12])
            )
            inserted += 1
    conn.commit()
    conn.close()
    print(f'[시드 명소] {inserted}개 생성 완료 (전체 {len(spots)}개)')


def seed_test_accounts():
    accounts = [
        ('test@example.com', 'test1234', '테스트유저'),
    ]
    conn = _make_conn()
    for email, password, nickname in accounts:
        existing = conn.execute(
            'SELECT id FROM users WHERE email = ?', (email,)
        ).fetchone()
        if not existing:
            user_id = str(uuid.uuid4())
            pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()
            conn.execute(
                "INSERT INTO users (id, nickname, email, password_hash, language, role) "
                "VALUES (?, ?, ?, ?, 'ko', 'user')",
                (user_id, nickname, email, pw_hash)
            )
            print(f'[시드 계정] 생성 — {email}')
        else:
            print(f'[시드 계정] 이미 존재 — {email}')
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
    seed_spots()
    seed_test_accounts()

    app = create_app()

    print(f'  포트: {PORT}')
    print(f'  환경: {os.getenv("FLASK_ENV", "development")}')
    print(f'  헬스체크: http://localhost:{PORT}/api')
    print('========================================')
    print()

    app.run(host='0.0.0.0', port=PORT, debug=os.getenv('FLASK_ENV') != 'production')
