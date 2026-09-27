# Student Face Photo Capture System

A web app for capturing full-resolution student face photos using a phone as the
camera, driven from a PC dashboard over local WiFi. No app install on the phone —
it runs in the browser.

---

## Two ways to get it

**Just want to run it** — use the [`main`](../../tree/main) branch. It holds a
ready-to-run Windows build: download, double-click `START.bat`, done. Nothing to
install, no Node.js needed.

**Want the source** — you are on it (`source-code`). Instructions below.

---

## Features

- Student roster with live progress tracking
- Phone pairs as the camera by scanning a QR code
- 5 face angles: Front, Right, Left, Up, Down
- Live view of the phone's camera on the PC dashboard
- Capture from the PC button or the phone shutter
- Full native camera resolution, JPEG quality 1.0, no re-encoding
- Blur detection rejects unsharp photos before saving
- One folder per student, named `Student Name (ID)`
- Retake any angle at any time, including after all five are captured
- Add and delete students from the dashboard
- Search and filter by name, ID or department; Pending / Completed filters
- Completion is derived from the photos on disk, never a manual flag

---

## How it works

```
PC browser (dashboard)  ←— Socket.io over HTTPS —→  phone browser (camera)
                    Express server on port 3000
```

1. Start the server on the PC
2. Open the dashboard, click **Connect Phone**, scan the QR code
3. Pick a student on the PC — the phone follows automatically
4. Capture the five angles
5. The dashboard updates the moment each photo is saved

The phone sends a small live preview to the dashboard several times a second so
the operator can see framing. Captures are taken on the phone at full sensor
resolution, so the preview never limits photo quality.

---

## Quick start (from source)

```bash
npm install
npm start
```

You will see:

```
Dashboard : https://localhost:3000
Phone URL : https://192.168.x.x:3000/camera.html
```

Phone and PC must be on the **same WiFi network**.

On Windows, `START.bat` does all of this in one step and also handles the
firewall rule and certificate trust described below.

---

## HTTPS is required

Browsers only allow camera access on a secure origin, so the server runs over
HTTPS. On first start it generates a self-signed certificate covering
`localhost` and the machine's current LAN address, cached under `data/certs`.
If the machine's address changes, the certificate is rebuilt on the next start.

Because the certificate is self-signed, it is not trusted until installed:

- **On the PC** — `START.bat` installs it into the Windows trusted store
  automatically (one admin prompt on first run).
- **On the phone** — open `https://<lan-ip>:3000/cert.crt` and install it as a
  **CA certificate**. Until then the browser blocks camera access, and the
  camera page will say so.

`START.bat` also adds a firewall rule for port 3000 so phones can reach the PC.

---

## Where photos are saved

```
photos/Student Name (ID)/front.jpg  right.jpg  left.jpg  up.jpg  down.jpg
```

Running from source, that is inside the project folder. In the packaged build
it is `Documents\PhotoBooth`, so photos do not depend on where the program was
copied to.

Set `PHOTOBOOTH_HOME` to override the location — useful for a shared drive.
Placing a file named `PORTABLE.txt` next to the program keeps everything in the
program's own folder instead, so a USB stick carries the work with it.

---

## Student roster

`data/students.json` — an array of records:

```json
{
  "id": "003-26-0001",
  "name": "Example Student",
  "phone": "01700000000",
  "email": "example@school.edu",
  "department": "Spark Education",
  "year": "2026",
  "dob": "2010-01-01"
}
```

Only `id` and `name` are required; `id` must be unique. See
`data/students.example.json`. Students can also be added from the dashboard.

The real roster is deliberately not committed — it holds personal data.

---

## Photo quality

| | |
|---|---|
| Resolution | the camera's maximum (e.g. 3024×4032 on a 12 MP phone) |
| Format | JPEG, quality 1.0 |
| Blur gate | rejected below a Laplacian variance threshold |
| Storage | the uploaded bytes are written straight to disk, never re-encoded |

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/students` | all students with completion status |
| `GET` | `/api/students/:id` | one student |
| `POST` | `/api/students` | add a student |
| `DELETE` | `/api/students/:id` | remove a student and their photos |
| `GET` | `/api/photos/:id/:angle` | serve a captured photo |
| `POST` | `/api/photo` | upload a photo (multipart) |
| `DELETE` | `/api/photos/:id/:angle` | delete one photo, for a retake |
| `GET` | `/api/qrcode` | QR code for phone pairing |
| `GET` | `/api/info` | address, port and angle list |
| `GET` | `/cert.crt` | the certificate, for installing on a phone |

### Socket events

**Dashboard → server:** `select-student`, `capture-request`

**Phone → server:** `camera-ready`, `preview-frame`, `capture-failed`

**Server → clients:** `student-selected`, `student-updated`, `student-deleted`,
`photo-saved`, `photo-deleted`, `camera-ready`, `camera-disconnected`

---

## Building the Windows executable

```bash
npm install --no-save pkg terser
node node_modules/pkg/lib-es5/bin.js . --targets node18-win-x64 --output dist/PhotoBooth.exe
```

The web files and the socket.io browser client are bundled inside the
executable, so it runs on its own. A `public` folder placed beside the program
overrides the embedded copy, which is handy for tweaking the interface without
rebuilding.

---

## Dependencies

`express`, `socket.io`, `multer`, `fs-extra`, `qrcode`, `selfsigned`

---

## Technical reference

`BLUEPRINT.md` covers the architecture, photo pipeline, blur detection and
completion model in more depth. Note that parts of it predate the current
version.
