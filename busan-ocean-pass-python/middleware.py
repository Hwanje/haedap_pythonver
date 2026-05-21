import os
from functools import wraps
from flask import request, g, jsonify
import jwt
from dotenv import load_dotenv

load_dotenv()

JWT_SECRET = os.getenv('JWT_SECRET')
if not JWT_SECRET:
    raise RuntimeError('[인증] JWT_SECRET 환경변수가 설정되지 않았습니다.')


def _extract_token():
    auth = request.headers.get('Authorization', '')
    parts = auth.split()
    if len(parts) == 2 and parts[0].lower() == 'bearer':
        return parts[1]
    return None


def authenticate_token(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = _extract_token()
        if not token:
            return jsonify({
                'success': False,
                'error': '인증 토큰이 필요합니다. (Authentication token required)',
            }), 401
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
            g.user = payload
        except jwt.ExpiredSignatureError:
            return jsonify({
                'success': False,
                'error': '토큰이 만료되었습니다. 다시 로그인해 주세요. (Token expired)',
            }), 401
        except jwt.InvalidTokenError:
            return jsonify({
                'success': False,
                'error': '유효하지 않은 토큰입니다. (Invalid token)',
            }), 401
        return f(*args, **kwargs)
    return decorated


def optional_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = _extract_token()
        g.user = None
        if token:
            try:
                g.user = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
            except Exception:
                pass
        return f(*args, **kwargs)
    return decorated


def require_admin(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = _extract_token()
        if not token:
            return jsonify({
                'success': False,
                'error': '인증 토큰이 필요합니다. (Authentication token required)',
            }), 401
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
            g.user = payload
        except jwt.ExpiredSignatureError:
            return jsonify({'success': False, 'error': '토큰이 만료되었습니다.'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'success': False, 'error': '유효하지 않은 토큰입니다.'}), 401
        if g.user.get('role') != 'admin':
            return jsonify({
                'success': False,
                'error': '관리자 권한이 필요합니다. (Admin access required)',
            }), 403
        return f(*args, **kwargs)
    return decorated
