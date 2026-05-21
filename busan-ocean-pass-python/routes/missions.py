import json

from flask import Blueprint, g, jsonify

from db import get_db, q_all
from middleware import authenticate_token, optional_auth

missions_bp = Blueprint('missions', __name__)


@missions_bp.route('/', methods=['GET'])
@optional_auth
def list_missions():
    db       = get_db()
    missions = q_all(db,
        'SELECT id, name_ko, name_en, description, required_spot_ids, bonus_stamps, '
        'bonus_reward, icon, is_active, created_at FROM missions WHERE is_active = 1 ORDER BY created_at ASC'
    )

    if not missions:
        return jsonify({'success': True, 'count': 0, 'data': []})

    if not g.user:
        data = []
        for m in missions:
            try:
                req_ids = json.loads(m['required_spot_ids'] or '[]')
            except Exception:
                req_ids = []
            data.append({**m, 'required_spot_ids': req_ids, 'required_count': len(req_ids), 'progress': None})
        return jsonify({'success': True, 'count': len(data), 'data': data})

    visited_rows  = q_all(db, 'SELECT DISTINCT spot_id FROM stamp_logs WHERE user_id = ?', (g.user['id'],))
    visited_set   = {r['spot_id'] for r in visited_rows}

    completed_rows = q_all(db, 'SELECT mission_id FROM mission_completions WHERE user_id = ?', (g.user['id'],))
    completed_set  = {r['mission_id'] for r in completed_rows}

    data = []
    for m in missions:
        try:
            req_ids = json.loads(m['required_spot_ids'] or '[]')
        except Exception:
            req_ids = []

        req_count     = len(req_ids)
        visited_count = sum(1 for sid in req_ids if sid in visited_set)
        is_completed  = m['id'] in completed_set
        percent = 0 if req_count == 0 else (100 if is_completed else int(visited_count / req_count * 100))

        data.append({
            **m,
            'required_spot_ids': req_ids,
            'progress': {
                'visited_count':  visited_count,
                'required_count': req_count,
                'percent':        percent,
                'is_completed':   is_completed,
            },
        })

    return jsonify({'success': True, 'count': len(data), 'data': data})


@missions_bp.route('/my', methods=['GET'])
@authenticate_token
def my_missions():
    db          = get_db()
    completions = q_all(db,
        'SELECT mc.id AS completion_id, mc.completed_at, '
        'm.id AS mission_id, m.name_ko, m.name_en, m.description, '
        'm.required_spot_ids, m.bonus_stamps, m.bonus_reward, m.icon '
        'FROM mission_completions mc JOIN missions m ON m.id = mc.mission_id '
        'WHERE mc.user_id = ? ORDER BY mc.completed_at DESC',
        (g.user['id'],)
    )

    data = []
    for row in completions:
        try:
            req_ids = json.loads(row['required_spot_ids'] or '[]')
        except Exception:
            req_ids = []
        data.append({**row, 'required_spot_ids': req_ids})

    total_bonus = sum(row.get('bonus_stamps', 0) for row in data)
    return jsonify({'success': True, 'count': len(data), 'total_bonus_stamps': total_bonus, 'data': data})
