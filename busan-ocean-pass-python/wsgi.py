from app import create_app
from db import init_db
from app import sync_master_admin

init_db()
sync_master_admin()

app = create_app()
