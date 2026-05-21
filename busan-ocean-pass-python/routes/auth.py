import os
import re
import uuid
from datetime import datetime, timedelta

import bcrypt
import jwt
from flask import Blueprint, g, jsonify, request
from dotenv import load_dotenv

from db import get_db, q_one, q_run
from middleware import authenticate_token

load_dotenv()

auth_bp = Blueprint('auth', __name__)

JWT_SECRET     = os.getenv('JWT_SECRET')
JWT_EXPIRES_DAYS = int(os.getenv('JWT_EXPIRES_DAYS', '7'))
EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
SUPPORTED_LANGS = {'ko', 'en', 'ja', 'zh'}


def _make_token(user):
    payload = {
        'id':           user['id'],
        'email':        user['email'],
        'nickname':     user['nickname'],
        'role':         user['role'],
        'is_foreigner': user['is_foreigner'],
        'exp':          datetime.utcnow() + timedelta(days=JWT_EXPIRES_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')


@auth_bp.route('/register', methods=['POST'])
def register():
    data        = request.get_json() or {}
    nickname    = data.get('nickname', '')
    email       = data.get('email', '')
    password    = data.get('password', '')
    language    = data.get('language', 'ko')
    is_foreigner = data.get('is_foreigner', 0)

    if not isinstance(nickname, str) or not nickname.strip():
        return jsonify({'success': False, 'error': '닉네임은 필수입니다.'}), 400

    if not isinstance(email, str) or not EMAIL_RE.match(email.strip()):
        return jsonify({'success': False, 'error': '유효하지 않은 이메일 형식입니다.'}), 400

    if not isinstance(password, str) or len(password) < 6:
        return jsonify({'success': False, 'error': '비밀번호는 최소 6자 이상이어야 합니다.'}), 400

    safe_lang        = language if language in SUPPORTED_LANGS else 'ko'
    safe_is_foreigner = 1 if is_foreigner in (1, '1', True) else 0

    db = get_db()
    if q_one(db, 'SELECT id FROM users WHERE email = ?', (email.strip().lower(),)):
        return jsonify({'success': False, 'error': '이미 사용 중인 이메일입니다.'}), 409

    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()
    user_id = str(uuid.uuid4())

    q_run(db,
        'INSERT INTO users (id, nickname, email, password_hash, language, is_foreigner) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        (user_id, nickname.strip(), email.strip().lower(), pw_hash, safe_lang, safe_is_foreigner)
    )

    new_user = q_one(db,
        'SELECT id, nickname, email, language, role, is_foreigner, '
        'total_stamps, total_cashback, created_at FROM users WHERE id = ?',
        (user_id,)
    )

    token = _make_token(new_user)
    print(f'[인증] 회원가입 성공 — userId: {user_id}, email: {email.strip().lower()}')

    return jsonify({'success': True, 'message': '회원가입이 완료되었습니다.', 'token': token, 'user': new_user}), 201


@auth_bp.route('/login', methods=['POST'])
def login():
    data     = request.get_json() or {}
    email    = data.get('email', '')
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'success': False, 'error': '이메일과 비밀번호를 모두 입력해 주세요.'}), 400

    db   = get_db()
    user = q_one(db,
        'SELECT id, nickname, email, password_hash, language, role, '
        'is_foreigner, total_stamps, total_cashback, created_at '
        'FROM users WHERE email = ?',
        (email.strip().lower(),)
    )

    if not user:
        return jsonify({'success': False, 'error': '이메일 또는 비밀번호가 올바르지 않습니다.'}), 401

    if not bcrypt.checkpw(password.encode(), user['password_hash'].encode()):
        return jsonify({'success': False, 'error': '이메일 또는 비밀번호가 올바르지 않습니다.'}), 401

    token    = _make_token(user)
    safe_user = {k: v for k, v in user.items() if k != 'password_hash'}

    print(f'[인증] 로그인 성공 — userId: {user["id"]}, email: {user["email"]}')
    return jsonify({'success': True, 'message': '로그인에 성공했습니다.', 'token': token, 'user': safe_user})


@auth_bp.route('/me', methods=['GET'])
@authenticate_token
def me():
    db   = get_db()
    user = q_one(db,
        'SELECT id, nickname, email, language, role, is_foreigner, '
        'total_stamps, total_cashback, created_at FROM users WHERE id = ?',
        (g.user['id'],)
    )
    if not user:
        return jsonify({'success': False, 'error': '사용자를 찾을 수 없습니다.'}), 404
    return jsonify({'success': True, 'user': user})
