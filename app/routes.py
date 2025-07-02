from flask import Blueprint, request, jsonify, render_template, redirect, url_for
from . import db
from .models import MacTracking, ConvoyTracking
from datetime import datetime, timedelta
import time
import json

bp = Blueprint("routes", __name__)

# 🔁 Pass-by Detection Logic
REPEAT_THRESHOLD = timedelta(minutes=20)
SHORT_DWELL = 180  # seconds

def is_repeated_passby(entry: MacTracking) -> bool:
    dwell = entry.last_seen - entry.first_seen
    return (
        entry.visit_count > 1 and
        dwell < SHORT_DWELL and
        (time.time() - entry.last_seen) > REPEAT_THRESHOLD.total_seconds()
    )

# ────────────────────────────── HTML Views ────────────────────────────── #

@bp.route("/")
def index():
    return redirect(url_for("routes.dynamic_view"))

@bp.route("/dashboard")
def dashboard():
    return redirect(url_for("routes.dynamic_view"))

@bp.route("/dynamic")
def dynamic_view():
    return render_template("dynamic.html")

@bp.route("/convoy")
def convoy_view():
    return render_template("convoy.html")

@bp.route("/all")
def all_view():
    return render_template("all.html")
# ────────────────────────────── Data Ingest ────────────────────────────── #
@bp.route("/data", methods=["POST"])
def ingest_data():
    try:
        entries = request.get_json()
        if not isinstance(entries, list):
            entries = [entries]

        print(f"[DEBUG] Received {len(entries)} entries at {datetime.utcnow().isoformat()}")
        for entry in entries:
            print(f"→ MAC: {entry.get('mac')} | SSID: {entry.get('ssid')} | RSSI: {entry.get('rssi')} | Count: {entry.get('visit_count')}")

        now = time.time()
        new_entries = []

        for entry in entries:
            mac = entry.get("mac")
            if not mac:
                continue

            existing = MacTracking.query.filter_by(mac=mac).first()
            visit_count = entry.get("visit_count", 1)
            rssi = entry.get("rssi", -90)
            is_hidden = entry.get("is_hidden", False)

            first_octet = int(mac.split(":")[0], 16)
            locally_administered = bool(first_octet & 0b10)
            fingerprint = "ephemeral_probe" if (is_hidden and locally_administered) else "named_device"

            if existing:
                existing.rssi = rssi
                existing.channel = entry.get("channel", existing.channel)
                existing.visit_count = visit_count
                existing.last_seen = now
                existing.is_hidden = is_hidden
                existing.ssid = entry.get("ssid", existing.ssid)

                if visit_count > 800 and rssi >= -55 and not is_hidden:
                    existing.classification = "static"
                elif is_repeated_passby(existing):
                    existing.classification = "repeated_passby"
                else:
                    existing.classification = fingerprint

            else:
                classification = "static" if visit_count > 800 and rssi >= -55 and not is_hidden else fingerprint
                new = MacTracking(
                    mac=mac,
                    ssid=entry.get("ssid", ""),
                    rssi=rssi,
                    channel=entry.get("channel", 0),
                    uid=entry.get("uid", entry.get("ssid", "")),
                    visit_count=visit_count,
                    is_hidden=is_hidden,
                    classification=classification,
                    first_seen=now,
                    last_seen=now
                )

                ghost_window = 3600
                recent = MacTracking.query.filter_by(mac=mac).order_by(MacTracking.last_seen.desc()).first()
                if recent and (now - recent.last_seen) > ghost_window:
                    new.is_ghost = True

                db.session.add(new)
                new_entries.append(mac)

        db.session.commit()
        return jsonify({"status": "ok", "processed": len(new_entries)}), 200

    except Exception as e:
        print("[ERROR] /data →", e)
        return jsonify({"status": "error", "message": str(e)}), 500

# ────────────────────────────── API Routes ────────────────────────────── #

@bp.route("/api/dynamic")
def api_dynamic():
    now = time.time() - 86400
    data = MacTracking.query.filter(
        MacTracking.last_seen >= now,
        MacTracking.classification != "static"
    ).all()
    return jsonify([row_to_dict(r) for r in data])

@bp.route("/api/passbys")
def api_repeated_passbys():
    now = time.time() - 86400
    data = MacTracking.query.filter(
        MacTracking.classification == "repeated_passby",
        MacTracking.last_seen >= now
    ).all()
    return jsonify([row_to_dict(r) for r in data])

@bp.route("/api/all")
def api_all():
    now = time.time() - 86400
    data = MacTracking.query.filter(MacTracking.last_seen >= now).all()
    return jsonify([row_to_dict(r) for r in data])

@bp.route("/api/convoy")
def api_convoy():
    convoys = ConvoyTracking.query.order_by(ConvoyTracking.formation_time.desc()).limit(20).all()
    return jsonify([
        {
            "id": c.id,
            "formation_time": c.formation_time.strftime("%H:%M:%S"),
            "duration": c.duration,
            "prediction": c.prediction,
            "members": json.loads(c.members) if c.members else []
        } for c in convoys
    ])

@bp.route("/api/ping")
def ping():
    return {"status": "alive", "time": time.time()}

@bp.route("/api/seen")
def lookup_mac():
    mac = request.args.get("mac")
    if not mac:
        return {"error": "MAC address not provided"}, 400

    entry = MacTracking.query.filter_by(mac=mac).first()
    if not entry:
        return {"found": False, "mac": mac}

    return {
        "found": True,
        "mac": mac,
        "ssid": entry.ssid or "Hidden",
        "last_seen": datetime.utcfromtimestamp(entry.last_seen).isoformat()
            if isinstance(entry.last_seen, (int, float)) else entry.last_seen.isoformat(),
        "visit_count": entry.visit_count,
        "classification": entry.classification
    }

@bp.route("/flag_mac", methods=["POST"])
def flag_mac():
    data = request.get_json()
    mac = data.get("mac")
    flagged = data.get("flagged", True)
    record = MacTracking.query.filter_by(mac=mac).first()
    if record:
        record.flagged = flagged
        db.session.commit()
        return jsonify({"status": "ok", "mac": mac, "flagged": flagged})
    return jsonify({"status": "error", "message": "MAC not found"}), 404

@bp.route("/report")
def report_view():
    data = MacTracking.query.order_by(MacTracking.last_seen.desc()).limit(100).all()
    return render_template("report.html", entries=data)

@bp.route("/ghosts")
def ghost_view():
    return render_template("ghosts.html")

@bp.route("/api/ghosts")
def api_ghosts():
    now = time.time() - 86400
    data = MacTracking.query.filter(
        MacTracking.last_seen >= now,
        MacTracking.is_ghost == True
    ).all()
    return jsonify([row_to_dict(r) for r in data])

# ────────────────────────────── Helper ────────────────────────────── #

def row_to_dict(e):
    return {
        "ssid": e.ssid or "Hidden",
        "mac": e.mac,
        "channel": e.channel,
        "rssi": e.rssi,
        "visit_count": e.visit_count if e.classification != "static" else 0,
        "classification": e.classification,
        "first_seen": datetime.utcfromtimestamp(e.first_seen).isoformat()
            if isinstance(e.first_seen, (int, float)) else e.first_seen.isoformat(),
        "last_seen": datetime.utcfromtimestamp(e.last_seen).isoformat()
            if isinstance(e.last_seen, (int, float)) else e.last_seen.isoformat(),
        "flagged": e.flagged
    }
