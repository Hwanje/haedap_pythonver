/**
 * seed.js — 초기 데이터 시드 스크립트
 *
 * 실행 방법:
 *   npm run seed
 *
 * 특징:
 *   - 멱등성 보장: 이미 데이터가 존재하면 INSERT를 건너뜀
 *   - 중복 실행해도 에러 없이 안전하게 실행됨
 *
 * 시드 데이터:
 *   1. 계정 3개 (관리자, 일반 사용자, 외국인 테스트 사용자)
 *   2. 부산 해양 명소 30곳 (실제 GPS 좌표)
 *   3. 미션 4종 (여러 명소 조합 테마)
 *   4. 샘플 위키 2건 (pending 1, approved 1)
 */

'use strict';

require('dotenv').config();

const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
// sharedDb 객체는 단일 참조 — ready 대기 후 _db가 설정되면 바로 사용 가능
const db = require('../db/database');

// ──────────────────────────────────────────────
// 유틸리티
// ──────────────────────────────────────────────

/** 현재 시각을 SQLite 호환 문자열로 반환 */
function now() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/** 특정 날짜를 SQLite 호환 문자열로 반환 */
function dateStr(dateIso) {
  return dateIso.replace('T', ' ').substring(0, 19);
}

// ──────────────────────────────────────────────
// 1. 사용자 시드
// ──────────────────────────────────────────────

/**
 * 테스트 및 시연용 계정 3개를 생성합니다.
 *
 *   admin@busan-ocean.kr / admin1234   → role=admin
 *   test@example.com     / test1234    → role=user, language=ko
 *   john@example.com     / test1234    → role=user, language=en, is_foreigner=1
 */
async function seedUsers() {
  console.log('\n[시드] 사용자 데이터 확인...');

  const usersData = [
    {
      id:          uuidv4(),
      nickname:    '관리자',
      email:       'admin@busan-ocean.kr',
      password:    'admin1234',
      language:    'ko',
      role:        'admin',
      is_foreigner: 0,
    },
    {
      id:          uuidv4(),
      nickname:    '테스트유저',
      email:       'test@example.com',
      password:    'test1234',
      language:    'ko',
      role:        'user',
      is_foreigner: 0,
    },
    {
      id:          uuidv4(),
      nickname:    'JohnSmith',
      email:       'john@example.com',
      password:    'test1234',
      language:    'en',
      role:        'user',
      is_foreigner: 1,
    },
  ];

  const insertedUsers = {};

  for (const u of usersData) {
    // 이미 존재하면 ID를 조회만 하고 건너뜀
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(u.email);
    if (existing) {
      console.log(`  [건너뜀] 사용자 이미 존재: ${u.email}`);
      insertedUsers[u.email] = existing.id;
      continue;
    }

    const passwordHash = await bcrypt.hash(u.password, 10);
    db.prepare(`
      INSERT INTO users (id, nickname, email, password_hash, language, role, is_foreigner, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(u.id, u.nickname, u.email, passwordHash, u.language, u.role, u.is_foreigner, now());

    insertedUsers[u.email] = u.id;
    console.log(`  [생성] 사용자: ${u.email} (${u.role})`);
  }

  return insertedUsers;
}

// ──────────────────────────────────────────────
// 2. 명소 시드
// ──────────────────────────────────────────────

/**
 * 부산 해양 명소 30곳을 시드합니다.
 * 해안선 동→서 순서, 실제 GPS 좌표 사용.
 *
 * 카테고리:
 *   beach    - 해변 (5곳)
 *   port     - 항만·포구 (4곳)
 *   island   - 섬·등대 (4곳)
 *   culture  - 해양문화시설 (3곳)
 *   trail    - 해안산책로 (4곳)
 *   food     - 해양먹거리 (3곳)
 *   hidden   - 숨은 해안 명소 (7곳)
 */
function seedSpots() {
  console.log('\n[시드] 명소 데이터 확인...');

  const spotsData = [
    // ── 해변 (beach) ──
    {
      order: 1,
      name_ko: '해운대해수욕장',
      name_en: 'Haeundae Beach',
      name_ja: '海雲台海水浴場',
      name_zh: '海云台海水浴场',
      category: 'beach',
      latitude: 35.1587,
      longitude: 129.1604,
      address: '부산광역시 해운대구 우동',
      description_ko: '부산을 대표하는 해수욕장으로, 여름이면 수백만 명이 찾는 국내 최대 규모의 해변입니다. 백사장 길이 1.5km, 광안대교와 마린시티의 스카이라인이 어우러진 절경을 자랑합니다.',
      description_en: 'The most famous beach in Busan, attracting millions of visitors every summer. A 1.5km white sand beach with stunning views of Gwangan Bridge and Marine City skyline.',
    },
    {
      order: 2,
      name_ko: '송정해수욕장',
      name_en: 'Songjeong Beach',
      name_ja: '松亭海水浴場',
      name_zh: '松亭海水浴场',
      category: 'beach',
      latitude: 35.1790,
      longitude: 129.2003,
      address: '부산광역시 해운대구 송정동',
      description_ko: '해운대보다 한적한 분위기의 해변으로, 서핑과 윈드서핑의 성지로 알려진 곳입니다. 소나무 숲과 어우러진 자연 그대로의 해변 경관을 감상할 수 있습니다.',
      description_en: 'A quieter beach than Haeundae, known as a surfing and windsurfing paradise. Enjoy natural beach scenery surrounded by pine forests.',
    },
    {
      order: 3,
      name_ko: '광안리해수욕장',
      name_en: 'Gwangalli Beach',
      name_ja: '広安里海水浴場',
      name_zh: '广安里海水浴场',
      category: 'beach',
      latitude: 35.1531,
      longitude: 129.1184,
      address: '부산광역시 수영구 광안해변로',
      description_ko: '광안대교 야경으로 유명한 해변으로, 밤이 되면 형형색색의 조명으로 수놓인 대교가 해변과 어우러져 환상적인 풍경을 연출합니다. 부산의 밤문화 중심지이기도 합니다.',
      description_en: 'Famous for the night view of Gwangan Bridge. After dark, the bridge lights up in spectacular colors, creating a fantastic waterfront scene. Also the center of Busan\'s nightlife.',
    },
    {
      order: 4,
      name_ko: '송도해수욕장',
      name_en: 'Songdo Beach',
      name_ja: '松島海水浴場',
      name_zh: '松岛海水浴场',
      category: 'beach',
      latitude: 35.0785,
      longitude: 129.0197,
      address: '부산광역시 서구 암남동',
      description_ko: '부산 최초의 공설해수욕장으로 100년 이상의 역사를 지닌 곳입니다. 해상케이블카와 구름다리가 명물이며, 서쪽 해안의 아름다운 암남공원과 이어집니다.',
      description_en: 'Busan\'s first public beach with over 100 years of history. Famous for its ocean cable car and sky bridge, connected to the beautiful Amnam Park on the western coast.',
    },
    {
      order: 5,
      name_ko: '다대포해수욕장',
      name_en: 'Dadaepo Beach',
      name_ja: '多大浦海水浴場',
      name_zh: '多大浦海水浴场',
      category: 'beach',
      latitude: 35.0452,
      longitude: 128.9617,
      address: '부산광역시 사하구 다대동',
      description_ko: '국내 최대 규모의 낙조 분수와 넓은 백사장이 특징인 해변입니다. 특히 해질 무렵 낙동강 하구와 어우러지는 일몰 풍경은 부산 최고의 석양으로 손꼽힙니다.',
      description_en: 'A beach featuring the largest sunset fountain in Korea and wide sandy shores. The sunset view combined with the Nakdong River estuary is considered one of the best in Busan.',
    },

    // ── 항만·포구 (port) ──
    {
      order: 6,
      name_ko: '자갈치시장',
      name_en: 'Jagalchi Market',
      name_ja: 'チャガルチ市場',
      name_zh: '札嘎其市场',
      category: 'port',
      latitude: 35.0970,
      longitude: 129.0303,
      address: '부산광역시 중구 자갈치해안로',
      description_ko: '\'아지매\'로 유명한 우리나라 최대 수산시장입니다. 싱싱한 해산물을 저렴하게 즐길 수 있으며, 2층 전망대에서 부산항과 영도의 파노라마 뷰를 감상할 수 있습니다.',
      description_en: 'Korea\'s largest seafood market, famous for its female vendors (ajimae). Enjoy fresh seafood at affordable prices, and take in panoramic views of Busan Port and Yeongdo from the 2nd floor observatory.',
    },
    {
      order: 7,
      name_ko: '국제시장',
      name_en: 'Gukje Market',
      name_ja: '国際市場',
      name_zh: '国际市场',
      category: 'port',
      latitude: 35.0997,
      longitude: 129.0271,
      address: '부산광역시 중구 신창동',
      description_ko: '6.25전쟁 당시 피난민들이 생계를 위해 만든 역사적인 시장입니다. 영화 \'국제시장\'의 배경지로 유명하며, 전통과 현대가 공존하는 부산 원도심 문화의 중심입니다.',
      description_en: 'A historic market created by wartime refugees during the Korean War. Famous as the setting for the movie "Gukje Market," it\'s the cultural center of Busan\'s old downtown, where tradition meets modernity.',
    },
    {
      order: 8,
      name_ko: '부산항국제여객터미널',
      name_en: 'Busan Port International Ferry Terminal',
      name_ja: '釜山港国際旅客ターミナル',
      name_zh: '釜山港国际客运站',
      category: 'port',
      latitude: 35.1075,
      longitude: 129.0385,
      address: '부산광역시 동구 중앙대로',
      description_ko: '일본 시모노세키, 후쿠오카, 쓰시마 등으로 향하는 국제 여객선이 출발하는 터미널입니다. 부산과 일본을 잇는 해양 관문으로, 항만의 활기찬 풍경을 볼 수 있습니다.',
      description_en: 'The departure terminal for international ferries to Shimonoseki, Fukuoka, and Tsushima in Japan. A maritime gateway connecting Busan and Japan, offering a lively port atmosphere.',
    },
    {
      order: 9,
      name_ko: '영도대교',
      name_en: 'Yeongdo Bridge',
      name_ja: '影島大橋',
      name_zh: '影岛大桥',
      category: 'port',
      latitude: 35.0963,
      longitude: 129.0340,
      address: '부산광역시 중구 대교로',
      description_ko: '1934년 건설된 우리나라 최초의 도개교로, 매일 오후 2시에 다리가 들어올려지는 장면이 유명합니다. 전쟁 피난 시절 이산가족들이 재회를 기다리던 역사적인 장소입니다.',
      description_en: 'Korea\'s first drawbridge, built in 1934. Famous for its daily 2pm bridge-lifting ceremony. A historically significant site where separated families waited to reunite during the Korean War.',
    },

    // ── 섬·등대 (island) ──
    {
      order: 10,
      name_ko: '오륙도',
      name_en: 'Oryukdo Island',
      name_ja: '五六島',
      name_zh: '五六岛',
      category: 'island',
      latitude: 35.0784,
      longitude: 129.1327,
      address: '부산광역시 남구 용호동',
      description_ko: '조수에 따라 5개 또는 6개로 보이는 신비로운 섬입니다. 동해와 남해가 나뉘는 지점에 위치하여 해양 생태계가 풍부하며, 일출 명소로도 유명합니다.',
      description_en: 'A mysterious island cluster that appears as 5 or 6 islands depending on the tide. Located where the East Sea meets the South Sea, it\'s rich in marine ecology and famous for its sunrise views.',
    },
    {
      order: 11,
      name_ko: '태종대',
      name_en: 'Taejongdae',
      name_ja: '太宗台',
      name_zh: '太宗台',
      category: 'island',
      latitude: 35.0561,
      longitude: 129.0852,
      address: '부산광역시 영도구 동삼동',
      description_ko: '신라 태종 무열왕이 전국의 명궁들과 활쏘기를 즐겼다는 절경의 명소입니다. 파도가 만든 기암절벽과 망부석 전설, 전망대에서 보이는 대마도 풍경이 인상적입니다.',
      description_en: 'A scenic spot where Silla King Taejong reportedly enjoyed archery with skilled archers. Impressive rocky cliffs carved by waves, the legend of Mangbuseok stone, and views of Tsushima Island from the observatory.',
    },
    {
      order: 12,
      name_ko: '영도등대',
      name_en: 'Yeongdo Lighthouse',
      name_ja: '影島灯台',
      name_zh: '影岛灯塔',
      category: 'island',
      latitude: 35.0510,
      longitude: 129.0747,
      address: '부산광역시 영도구 동삼동',
      description_ko: '1906년 처음 불을 밝힌 100년 이상의 역사를 가진 등대입니다. 붉은 벽돌 외관이 아름다우며, 등대 아래로 펼쳐지는 남해 풍경이 탁월합니다. 등대문화유산으로도 지정되어 있습니다.',
      description_en: 'A lighthouse first lit in 1906 with over 100 years of history. Features beautiful red brick architecture and spectacular views of the South Sea. Designated as a lighthouse cultural heritage site.',
    },
    {
      order: 13,
      name_ko: '이기대공원',
      name_en: 'Igidae Park',
      name_ja: '二妓台公園',
      name_zh: '二妓台公园',
      category: 'island',
      latitude: 35.1018,
      longitude: 129.1217,
      address: '부산광역시 남구 용호동',
      description_ko: '부산 남구 해안에 위치한 자연공원으로, 기암괴석과 해식절벽이 어우러진 절경을 자랑합니다. 임진왜란 당시 두 명의 기생이 왜장을 안고 바다에 뛰어든 이야기가 전해집니다.',
      description_en: 'A natural park on the coast of Busan\'s Nam-gu, featuring spectacular rocky cliffs and sea-eroded formations. Linked to the legend of two entertainers who jumped into the sea with Japanese commanders during the Imjin War.',
    },

    // ── 해양문화시설 (culture) ──
    {
      order: 14,
      name_ko: '국립해양박물관',
      name_en: 'National Maritime Museum',
      name_ja: '国立海洋博物館',
      name_zh: '国立海洋博物馆',
      category: 'culture',
      latitude: 35.0697,
      longitude: 129.0815,
      address: '부산광역시 영도구 해양로',
      description_ko: '우리나라 최초의 국립 해양 전문 박물관으로, 해양 역사와 문화를 총망라한 전시를 선보입니다. 수중 체험 시설과 4D 영상관, 어린이 체험실이 특히 인기 있습니다.',
      description_en: 'Korea\'s first national maritime museum, showcasing comprehensive exhibitions on maritime history and culture. Popular for its underwater experience facilities, 4D theater, and children\'s activity room.',
    },
    {
      order: 15,
      name_ko: '부산아쿠아리움',
      name_en: 'Busan Aquarium',
      name_ja: '釜山アクアリウム',
      name_zh: '釜山水族馆',
      category: 'culture',
      latitude: 35.1579,
      longitude: 129.1610,
      address: '부산광역시 해운대구 해운대해변로',
      description_ko: '해운대 해변에 위치한 국내 최대 수족관입니다. 250여 종 35,000여 마리의 해양생물이 전시되며, 80m 해저 터널을 걸으며 상어와 가오리를 가까이서 관찰할 수 있습니다.',
      description_en: 'The largest aquarium in Korea, located on Haeundae Beach. Features over 250 species and 35,000 marine creatures. Walk through an 80m underwater tunnel and observe sharks and rays up close.',
    },
    {
      order: 16,
      name_ko: '송도해상케이블카',
      name_en: 'Songdo Ocean Cable Car',
      name_ja: '松島海上ケーブルカー',
      name_zh: '松岛海上缆车',
      category: 'culture',
      latitude: 35.0805,
      longitude: 129.0183,
      address: '부산광역시 서구 암남동',
      description_ko: '우리나라 최초의 해상 케이블카로, 바다 위를 가로질러 해안 절경을 조망합니다. 투명 바닥 케이블카에서는 발 아래로 펼쳐지는 바다가 아찔한 스릴을 선사합니다.',
      description_en: 'Korea\'s first ocean cable car, crossing over the sea with spectacular coastal views. The transparent-floor cable car offers a thrilling view of the ocean directly below your feet.',
    },

    // ── 해안산책로 (trail) ──
    {
      order: 17,
      name_ko: '갈맷길1코스',
      name_en: 'Galmaetgil Course 1',
      name_ja: 'カルメッキル1コース',
      name_zh: '加尔梅路1号线',
      category: 'trail',
      latitude: 35.1790,
      longitude: 129.2005,
      address: '부산광역시 기장군 기장읍 일원',
      description_ko: '부산의 대표 도보 여행길인 갈맷길의 첫 번째 코스입니다. 기장군 해안을 따라 걷는 이 코스는 청정 해양 경관과 어촌 마을의 정취를 동시에 즐길 수 있습니다.',
      description_en: 'The first course of Galmaetgil, Busan\'s signature walking trail. This coastal route along Gijang-gun offers pristine ocean views and the charm of traditional fishing villages.',
    },
    {
      order: 18,
      name_ko: '이기대해안산책로',
      name_en: 'Igidae Coastal Trail',
      name_ja: '二妓台海岸遊歩道',
      name_zh: '二妓台海岸步道',
      category: 'trail',
      latitude: 35.1001,
      longitude: 129.1250,
      address: '부산광역시 남구 용호동',
      description_ko: '이기대 자연공원을 따라 이어지는 해안 산책로로, 기암괴석과 에메랄드빛 바다가 어우러진 아름다운 트레킹 코스입니다. 광안대교와 마린시티 전망이 인상적입니다.',
      description_en: 'A coastal trail along Igidae Natural Park, offering beautiful trekking through rocky formations and emerald waters. Impressive views of Gwangan Bridge and Marine City.',
    },
    {
      order: 19,
      name_ko: '청사포다릿돌전망대',
      name_en: 'Cheongsapo Stepping Stone Observatory',
      name_ja: '青沙浦踏み石展望台',
      name_zh: '青沙浦垫脚石观景台',
      category: 'trail',
      latitude: 35.1706,
      longitude: 129.2007,
      address: '부산광역시 해운대구 청사포로',
      description_ko: '청사포 해안 절벽 위에 설치된 투명 유리 전망대입니다. 동해 바다 위에 떠있는 듯한 아찔한 경험을 선사하며, 청사포 등대와 해안 풍경이 어우러진 절경을 자랑합니다.',
      description_en: 'A transparent glass observatory perched on the cliff above Cheongsapo coast. Offers a thrilling floating-above-the-sea experience with spectacular views of Cheongsapo lighthouse and coastline.',
    },
    {
      order: 20,
      name_ko: '흰여울문화마을',
      name_en: 'Huinnyeoul Culture Village',
      name_ja: 'フィンヨウル文化村',
      name_zh: '白浪文化村',
      category: 'trail',
      latitude: 35.0839,
      longitude: 129.0222,
      address: '부산광역시 영도구 절영로',
      description_ko: '절영도 해안 절벽을 따라 형성된 감성 문화마을입니다. 한국판 산토리니로 불리며, 좁은 골목길과 알록달록한 집들이 그림 같은 풍경을 연출합니다. 영화 촬영지로도 유명합니다.',
      description_en: 'A charming cultural village formed along the coastal cliffs of Yeongdo. Known as Korea\'s Santorini, with picturesque narrow alleyways and colorful houses. A popular film shooting location.',
    },

    // ── 해양먹거리 (food) ──
    {
      order: 21,
      name_ko: '기장시장',
      name_en: 'Gijang Market',
      name_ja: '機張市場',
      name_zh: '机张市场',
      category: 'food',
      latitude: 35.2441,
      longitude: 129.2135,
      address: '부산광역시 기장군 기장읍',
      description_ko: '기장 멸치, 미역, 해산물로 유명한 전통 재래시장입니다. 특히 봄철 기장 멸치젓은 전국적으로 유명하며, 갓 잡아 올린 싱싱한 해산물을 저렴한 가격에 구입할 수 있습니다.',
      description_en: 'A traditional market famous for Gijang anchovies, seaweed, and seafood. Particularly known nationwide for spring anchovy sauce, with fresh-caught seafood available at affordable prices.',
    },
    {
      order: 22,
      name_ko: '민락회타운',
      name_en: 'Millak Raw Fish Town',
      name_ja: '民楽フェタウン',
      name_zh: '民乐生鱼片街',
      category: 'food',
      latitude: 35.1542,
      longitude: 129.1290,
      address: '부산광역시 수영구 민락동',
      description_ko: '광안리 인근에 위치한 부산 최대의 횟집 거리입니다. 수십 개의 횟집이 밀집해 있어 다양한 종류의 신선한 회를 즐길 수 있으며, 광안대교 야경을 감상하며 식사하는 것이 매력입니다.',
      description_en: 'The largest raw fish restaurant street in Busan, near Gwangalli Beach. Dozens of restaurants offer various fresh sashimi options, with the added pleasure of dining with views of Gwangan Bridge at night.',
    },
    {
      order: 23,
      name_ko: '송정활어회센터',
      name_en: 'Songjeong Live Fish Center',
      name_ja: '松亭活魚刺身センター',
      name_zh: '松亭活鱼生鱼片中心',
      category: 'food',
      latitude: 35.1795,
      longitude: 129.2010,
      address: '부산광역시 해운대구 송정동',
      description_ko: '송정 어촌계에서 운영하는 활어회 전문 단지입니다. 인근 어항에서 갓 잡아 올린 신선한 해산물을 합리적인 가격에 즐길 수 있으며, 직접 고른 활어를 즉석에서 손질해 제공합니다.',
      description_en: 'A live seafood complex operated by Songjeong fishing cooperative. Enjoy fresh seafood caught just minutes away at reasonable prices, with fish cleaned and prepared right before your eyes.',
    },

    // ── 숨은 해안 명소 (hidden) ──
    {
      order: 24,
      name_ko: '청학배수지전망대',
      name_en: 'Cheonghak Reservoir Observatory',
      name_ja: '青鶴貯水池展望台',
      name_zh: '青鹤水库观景台',
      category: 'hidden',
      latitude: 35.0891,
      longitude: 129.0391,
      address: '부산광역시 영도구 청학동',
      description_ko: '영도 주민들이 즐겨 찾는 숨은 야경 명소입니다. 부산항 전경과 남항대교, 영도 야경이 한눈에 펼쳐지는 곳으로, 외지인에게는 잘 알려지지 않은 보석 같은 장소입니다.',
      description_en: 'A hidden night view spot popular with Yeongdo locals. Offers panoramic views of Busan Port, Namhang Bridge, and Yeongdo at night — a hidden gem not well known to outsiders.',
    },
    {
      order: 25,
      name_ko: '아미산전망대',
      name_en: 'Amisan Observatory',
      name_ja: '峨眉山展望台',
      name_zh: '峨眉山观景台',
      category: 'hidden',
      latitude: 35.0872,
      longitude: 129.0199,
      address: '부산광역시 서구 서대신동',
      description_ko: '감천문화마을 인근 아미산에 위치한 전망대입니다. 감천항과 송도 해변, 다대포 방향의 탁 트인 바다 전망을 자랑하며, 일몰 때 아름다운 풍경으로 유명합니다.',
      description_en: 'An observatory on Amisan Mountain near Gamcheon Culture Village. Boasts open ocean views toward Gamcheon Harbor, Songdo Beach, and Dadaepo, famous for its beautiful sunsets.',
    },
    {
      order: 26,
      name_ko: '두무진해안',
      name_en: 'Dumujin Coast',
      name_ja: '豆無津海岸',
      name_zh: '豆无津海岸',
      category: 'hidden',
      latitude: 35.0490,
      longitude: 128.9760,
      address: '부산광역시 사하구 다대동',
      description_ko: '다대포 인근의 숨겨진 해안으로, 기암괴석과 청정한 바다가 어우러진 비경을 자랑합니다. 낚시 명소로도 알려져 있으며, 낙조 때 황금빛으로 물드는 바위 풍경이 아름답습니다.',
      description_en: 'A hidden coastal gem near Dadaepo, featuring dramatic rock formations and pristine waters. Known as a fishing spot, with beautiful golden-hued rocky scenery during sunset.',
    },
    {
      order: 27,
      name_ko: '동백섬',
      name_en: 'Dongbaek Island',
      name_ja: '冬柏島',
      name_zh: '冬柏岛',
      category: 'hidden',
      latitude: 35.1567,
      longitude: 129.1571,
      address: '부산광역시 해운대구 동백로',
      description_ko: '육지와 연결된 작은 반도형 섬으로, 동백나무 군락지로 유명합니다. 해미당의 APEC 기념 조형물과 누리마루 APEC하우스가 위치하며, 해운대 전망 산책로가 인기입니다.',
      description_en: 'A small peninsula connected to land, famous for its winter camellia groves. Home to APEC memorial sculptures and the Nurimaru APEC House, with a popular walking trail overlooking Haeundae.',
    },
    {
      order: 28,
      name_ko: '청사포항구',
      name_en: 'Cheongsapo Harbor',
      name_ja: '青沙浦港',
      name_zh: '青沙浦港口',
      category: 'hidden',
      latitude: 35.1698,
      longitude: 129.2010,
      address: '부산광역시 해운대구 청사포로',
      description_ko: '아담한 어촌 항구로, 해녀들의 물질 작업과 어부들의 생업을 가까이에서 볼 수 있는 곳입니다. 등대와 방파제, 소박한 어촌 풍경이 도시 속 힐링 명소로 각광받고 있습니다.',
      description_en: 'A small fishing harbor where you can watch haenyeo (female divers) at work and fishermen going about their daily lives. The lighthouse, breakwater, and quaint village atmosphere make it a beloved healing spot.',
    },
    {
      order: 29,
      name_ko: '암남공원',
      name_en: 'Amnam Park',
      name_ja: '岩南公園',
      name_zh: '岩南公园',
      category: 'hidden',
      latitude: 35.0765,
      longitude: 129.0145,
      address: '부산광역시 서구 암남동',
      description_ko: '송도 서쪽 끝 암반 지형에 조성된 자연공원입니다. 잘 정비된 탐방로를 따라 기암절벽과 남해의 절경을 감상할 수 있으며, 낚시와 트레킹을 즐기는 부산 시민들의 쉼터입니다.',
      description_en: 'A natural park built on rocky terrain at the western end of Songdo. Well-maintained trails offer views of dramatic cliffs and South Sea scenery — a retreat for Busan citizens who enjoy fishing and trekking.',
    },
    {
      order: 30,
      name_ko: '몰운대',
      name_en: 'Morundae',
      name_ja: '没雲台',
      name_zh: '没云台',
      category: 'hidden',
      latitude: 35.0447,
      longitude: 128.9607,
      address: '부산광역시 사하구 다대동',
      description_ko: '낙동강 하구와 남해가 만나는 지점의 아름다운 곶입니다. 구름이 섬 위로 쏟아져 내린다는 뜻의 이름처럼, 안개와 구름이 자아내는 신비로운 풍경으로 유명합니다.',
      description_en: 'A beautiful promontory where the Nakdong River estuary meets the South Sea. True to its name meaning "cloud-pouring cape," it\'s famous for its mystical fog and cloud scenery.',
    },
  ];

  // 이미 데이터가 있으면 건너뜀
  const existingCount = db.prepare('SELECT COUNT(*) AS cnt FROM spots').get().cnt;
  if (existingCount > 0) {
    console.log(`  [건너뜀] 명소 데이터 이미 존재 (${existingCount}건)`);

    // 기존 명소의 ID 목록을 order 기준으로 반환 (미션 시드에서 사용)
    const existingSpots = db.prepare('SELECT id, order_in_route FROM spots ORDER BY order_in_route ASC').all();
    return existingSpots.reduce((map, s) => {
      map[s.order_in_route] = s.id;
      return map;
    }, {});
  }

  const spotIdByOrder = {};

  for (const spot of spotsData) {
    const id = uuidv4();
    const qrCode = `QR_SPOT_${String(spot.order).padStart(2, '0')}`;

    db.prepare(`
      INSERT INTO spots (
        id, name_ko, name_en, name_ja, name_zh,
        category, latitude, longitude, address,
        description_ko, description_en,
        qr_code, base_stamp_count, order_in_route, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id,
      spot.name_ko, spot.name_en, spot.name_ja, spot.name_zh,
      spot.category,
      spot.latitude, spot.longitude,
      spot.address,
      spot.description_ko, spot.description_en,
      qrCode,
      1, // base_stamp_count 기본값 1
      spot.order,
      now()
    );

    spotIdByOrder[spot.order] = id;
    console.log(`  [생성] 명소 ${spot.order}: ${spot.name_ko} (${qrCode})`);
  }

  return spotIdByOrder;
}

// ──────────────────────────────────────────────
// 3. 미션 시드
// ──────────────────────────────────────────────

/**
 * 미션 4종을 시드합니다.
 *
 * required_spot_ids는 명소 order 번호를 실제 spot UUID로 변환하여 저장합니다.
 */
function seedMissions(spotIdByOrder) {
  console.log('\n[시드] 미션 데이터 확인...');

  const existingCount = db.prepare('SELECT COUNT(*) AS cnt FROM missions').get().cnt;
  if (existingCount > 0) {
    console.log(`  [건너뜀] 미션 데이터 이미 존재 (${existingCount}건)`);
    return;
  }

  const missionsData = [
    {
      name_ko:       '부산 야경 항해',
      name_en:       'Busan Night View Voyage',
      description:   '부산의 아름다운 야경 명소를 모두 방문하고 야경 항해사가 되어보세요!',
      spot_orders:   [3, 19, 20], // 광안리, 청사포다릿돌, 흰여울
      bonus_stamps:  15,
      bonus_reward:  '야경카페 쿠폰',
      icon:          '🌃',
    },
    {
      name_ko:       '해녀의 길',
      name_en:       'Way of the Haenyeo',
      description:   '영도의 해녀 문화를 따라 걸으며 바다의 역사를 느껴보세요.',
      spot_orders:   [9, 11, 12], // 영도대교, 태종대, 영도등대
      bonus_stamps:  12,
      bonus_reward:  '해녀촌 체험권',
      icon:          '🤿',
    },
    {
      name_ko:       '해양수도 항해사',
      name_en:       'Maritime Capital Navigator',
      description:   '부산 해양수도의 핵심 명소 5곳을 정복하면 명예 항해사 칭호가 주어집니다!',
      spot_orders:   [6, 14, 10, 8, 11], // 자갈치, 해양박물관, 오륙도, 부산항, 태종대
      bonus_stamps:  30,
      bonus_reward:  '동백전 1만원',
      icon:          '⚓',
    },
    {
      name_ko:       '숨은 명소 발견대',
      name_en:       'Hidden Gem Explorer',
      description:   '아직 많이 알려지지 않은 부산의 숨은 해안 보석들을 발견해보세요!',
      spot_orders:   [24, 25, 26, 30], // 청학배수지, 아미산, 두무진, 몰운대
      bonus_stamps:  25,
      bonus_reward:  '부산 특산물 박스',
      icon:          '🗺️',
    },
  ];

  for (const mission of missionsData) {
    // spot_orders → 실제 spot UUID 변환
    const requiredSpotIds = mission.spot_orders.map(order => spotIdByOrder[order]).filter(Boolean);

    if (requiredSpotIds.length !== mission.spot_orders.length) {
      console.warn(`  [경고] 미션 '${mission.name_ko}' — 일부 명소 ID를 찾지 못했습니다.`);
    }

    db.prepare(`
      INSERT INTO missions (id, name_ko, name_en, description, required_spot_ids, bonus_stamps, bonus_reward, icon, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      uuidv4(),
      mission.name_ko,
      mission.name_en,
      mission.description,
      JSON.stringify(requiredSpotIds),
      mission.bonus_stamps,
      mission.bonus_reward,
      mission.icon,
      now()
    );

    console.log(`  [생성] 미션: ${mission.name_ko} (필요 명소 ${requiredSpotIds.length}곳, 보너스 ${mission.bonus_stamps}스탬프)`);
  }
}

// ──────────────────────────────────────────────
// 4. 샘플 위키 시드
// ──────────────────────────────────────────────

/**
 * 샘플 위키 게시글 2건을 시드합니다.
 *   - pending 1건  : 이벤트 카테고리 (심사 대기)
 *   - approved 1건 : 숨은 명소 카테고리 (승인 완료)
 */
function seedWikiPosts(userIds, spotIdByOrder) {
  console.log('\n[시드] 위키 데이터 확인...');

  const existingCount = db.prepare('SELECT COUNT(*) AS cnt FROM wiki_posts').get().cnt;
  if (existingCount > 0) {
    console.log(`  [건너뜀] 위키 데이터 이미 존재 (${existingCount}건)`);
    return;
  }

  const testUserId  = userIds['test@example.com'];
  const adminUserId = userIds['admin@busan-ocean.kr'];

  if (!testUserId) {
    console.warn('  [경고] 테스트 사용자를 찾을 수 없어 위키 시드를 건너뜁니다.');
    return;
  }

  // 샘플 1: 이벤트 카테고리 (pending)
  db.prepare(`
    INSERT INTO wiki_posts (
      id, user_id, title, content, category,
      spot_id, event_start_date, event_end_date,
      status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    uuidv4(),
    testUserId,
    '해운대 야시장 2026',
    '해운대 해수욕장 백사장에서 열리는 여름 야시장입니다. 매주 금~일 저녁 6시부터 11시까지 운영하며, 부산 먹거리와 공연, 야경을 한번에 즐길 수 있습니다. 작년에 방문했는데 어묵, 씨앗호떡, 물회 등 정말 다양하고 맛있는 먹거리가 가득했습니다. 올해는 더 크게 열린다고 하니 꼭 방문해보세요!',
    'event',
    spotIdByOrder[1] || null, // 해운대해수욕장
    '2026-07-01',
    '2026-08-31',
    now()
  );
  console.log('  [생성] 위키(pending): 해운대 야시장 2026');

  // 샘플 2: 숨은 명소 카테고리 (approved)
  const approvedPostId = uuidv4();
  db.prepare(`
    INSERT INTO wiki_posts (
      id, user_id, title, content, category,
      spot_id,
      status, admin_note, reviewed_by, reviewed_at,
      reward_stamps, helpful_count, view_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    approvedPostId,
    testUserId,
    '청학배수지 숨은 포토스팟',
    '청학배수지 전망대 옆 작은 계단을 올라가면 나오는 숨은 포토스팟을 소개합니다! 정면에는 부산항과 영도, 왼쪽으로는 남항대교가 한눈에 보이고, 날씨 좋은 날에는 일본 대마도까지 보인다고 합니다. 특히 해 질 무렵 황금빛으로 물드는 바다와 부산항의 풍경이 정말 환상적입니다. 삼각대 필수, 해질녘 30분 전에 도착하면 최고의 사진을 찍을 수 있습니다.',
    'hidden_spot',
    spotIdByOrder[24] || null, // 청학배수지전망대
    '훌륭한 로컬 정보입니다. 승인합니다.',
    adminUserId || null,
    dateStr(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()), // 2일 전
    15,  // reward_stamps
    8,   // helpful_count
    42,  // view_count
    dateStr(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())  // 3일 전
  );
  console.log('  [생성] 위키(approved): 청학배수지 숨은 포토스팟 (보상 15스탬프)');

  // 승인된 위키의 보상 스탬프를 test 사용자에게 반영
  const { recalculateUserStamps } = require('../utils/helpers');
  recalculateUserStamps(testUserId, db);

  // sql.js 모드에서는 변경 사항을 디스크에 저장
  if (db.usingFallback && typeof db.saveToFile === 'function') {
    db.saveToFile();
  }
}

// ──────────────────────────────────────────────
// 메인 실행
// ──────────────────────────────────────────────

/**
 * 시드 스크립트 진입점.
 * DB 초기화(better-sqlite3 또는 sql.js) 완료 후 각 시드 함수를 순서대로 실행합니다.
 */
async function main() {
  console.log('========================================');
  console.log('  부산오션패스 데이터 시드 시작');
  console.log('========================================');

  // DB 초기화 완료 대기 (sql.js 비동기 초기화 대응)
  // better-sqlite3 모드에서는 즉시 해소, sql.js 모드에서는 wasm 로드 후 해소
  await db.ready;

  try {
    // 1. 사용자 시드
    const userIds = await seedUsers();

    // 2. 명소 시드
    const spotIdByOrder = seedSpots();

    // 3. 미션 시드 (명소 ID 필요)
    seedMissions(spotIdByOrder);

    // 4. 위키 시드 (사용자 ID + 명소 ID 필요)
    seedWikiPosts(userIds, spotIdByOrder);

    console.log('\n========================================');
    console.log('  시드 완료!');
    console.log('');
    console.log('  테스트 계정:');
    console.log('    관리자: admin@busan-ocean.kr / admin1234');
    console.log('    일반:   test@example.com / test1234');
    console.log('    외국인: john@example.com / test1234');
    console.log('========================================\n');

  } catch (err) {
    console.error('\n[시드 오류]', err);
    process.exit(1);
  }

  process.exit(0);
}

main();
