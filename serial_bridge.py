import serial
import requests
import time

SERIAL_PORT = "/dev/ttyUSB0"  # update as needed
BAUD_RATE = 115200
ENDPOINT = "http://localhost:5000/data"

ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
print(f" Serial bridge listening on {SERIAL_PORT}...")

while True:
    try:
        line = ser.readline().decode("utf-8", errors="ignore").strip()
        if not line or not line.startswith("["):
            continue
        print(f" {line}")
        r = requests.post(ENDPOINT, data=line, headers={"Content-Type": "application/json"})
        print(f"→ Sent {len(line)} bytes | Status: {r.status_code}")
    except Exception as e:
        print(f"[ERROR] {e}")
        time.sleep(1)
