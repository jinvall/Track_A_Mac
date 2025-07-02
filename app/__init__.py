from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from flask_migrate import Migrate

db = SQLAlchemy()
migrate = Migrate()

def create_app():
    app = Flask(__name__, instance_relative_config=True)
    CORS(app)

    app.config.from_mapping(
        SECRET_KEY="trackamac_secret",
        SQLALCHEMY_DATABASE_URI="sqlite:///track_a_mac.db",
        SQLALCHEMY_TRACK_MODIFICATIONS=False
    )

    db.init_app(app)
    migrate.init_app(app, db)  # ← safe to use app here now

    from . import models  # after db is ready

    from .routes import bp as routes_bp
    app.register_blueprint(routes_bp)

    return app
