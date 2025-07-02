from . import db
from datetime import datetime

class MacTracking(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    mac = db.Column(db.String(17), unique=True, nullable=False)
    ssid = db.Column(db.String(64))
    rssi = db.Column(db.Integer)
    channel = db.Column(db.Integer)
    visit_count = db.Column(db.Integer, default=1)
    uid = db.Column(db.String(64))
    classification = db.Column(db.String(10))  # 'static' or 'dynamic'
    is_hidden = db.Column(db.Boolean, default=False)
    flagged = db.Column(db.Boolean, default=False)
    first_seen = db.Column(db.Float)
    last_seen = db.Column(db.Float)
    is_ghost = db.Column(db.Boolean, default=False)


class ConvoyTracking(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    members = db.Column(db.Text)  # Store JSON string of MACs or SSIDs
    formation_time = db.Column(db.DateTime, default=datetime.utcnow)
    duration = db.Column(db.Float)
    prediction = db.Column(db.String(64))
