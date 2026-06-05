from app import create_app
from db import init_db
from app import sync_master_admin, seed_spots, seed_test_accounts

# 영속 DB(Neon)이므로 최초 1회만 실제로 채워지고, 이후 재기동 시에는
# 존재 여부 체크로 건너뛴다(멱등).
init_db()
sync_master_admin()
seed_spots()
seed_test_accounts()

app = create_app()
