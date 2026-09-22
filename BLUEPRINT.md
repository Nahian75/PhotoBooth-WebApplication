# 🎓 Student Face Photo Capture System — Full Pipeline Blueprint

> A complete technical reference for understanding every layer of the system,
> from the first HTTP request to the final `.jpg` file saved on disk.

---

## 1. Big Picture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                         LOCAL WIFI NETWORK                             │
│                                                                        │
│   ┌──────────────────┐   WebSocket (Socket.io)  ┌──────────────────┐  │
│   │   PC Browser     │ ◄──────────────────────► │  Phone Browser   │  │
│   │  (Dashboard)     │                           │  (Camera View)   │  │
│   │  index.html      │                           │  camera.html     │  │
│   └────────┬─────────┘                           └────────┬─────────┘  │
│            │  HTTP REST                                   │ HTTP POST  │
│            ▼                                              ▼            │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │                    Node.js / Express Server                      │ │
│   │                       server.js (Port 3000)                      │ │
│   │                                                                  │ │
│   │   ┌────────────┐  ┌─────────────┐  ┌──────────────────────────┐ │ │
│   │   │  REST API  │  │  Socket.io  │  │  Static File Server       │ │ │
│   │   │ /api/...   │  │  (WS Hub)   │  │  /public/**               │ │ │
│   │   └────────────┘  └─────────────┘  └──────────────────────────┘ │ │
│   └────────────────────────────┬─────────────────────────────────────┘ │
│                                │ fs.writeFile()                         │
│                                ▼                                        │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │                     File System (PC Disk)                        │ │
│   │   data/students.json                                             │ │
│   │   photos/                                                        │ │
│   │     STU001/  front.jpg  right.jpg  left.jpg  up.jpg  down.jpg   │ │
│   │     STU002/  center.jpg ...                                      │ │
│   └──────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

**Key insight:** The phone is just a browser pointing at the same server.
No app install. No Bluetooth. No USB. Just WiFi + a URL.

---

## 2. Project File Structure

```
webapp/
│
├── server.js                    ← Entry point. All server logic lives here.
├── package.json                 ← Dependencies and npm scripts
│
├── data/
│   └── students.json            ← Student database (100 pre-seeded records)
│
├── photos/                      ← Auto-created on first run
│   └── <student_id>/            ← One folder per student (auto-created)
│       ├── front.jpg
│       ├── right.jpg
│       ├── left.jpg
│       ├── up.jpg
│       ├── down.jpg
│       └── center.jpg
│
└── public/                      ← All browser-side files (served statically)
    ├── index.html               ← PC Dashboard page
    ├── camera.html              ← Phone Camera page
    ├── css/
    │   ├── dashboard.css        ← Dashboard styles
    │   └── camera.css           ← Camera styles
    └── js/
        ├── dashboard.js         ← Dashboard logic (vanilla JS)
        └── camera.js            ← Camera logic (vanilla JS + WebRTC)
```

---

## 3. Technology Stack

| Layer            | Technology            | Why                                             |
|------------------|-----------------------|-------------------------------------------------|
| Runtime          | Node.js               | Cross-platform, non-blocking I/O for file ops   |
| HTTP Server      | Express.js            | Minimal, fast REST API + static file serving    |
| Real-time        | Socket.io             | WebSocket wrapper — works through NAT/firewalls |
| File Upload      | Multer                | Streams multipart/form-data into memory buffer  |
| File System      | fs-extra              | `ensureDir`, `writeFile`, `remove` with promises|
| QR Code          | qrcode                | Generates base64 PNG for phone pairing          |
| Camera API       | WebRTC (getUserMedia) | Native browser API — no plugins needed          |
| Blur Detection   | Laplacian Variance    | Math on pixel data — pure JS, zero dependencies |
| Frontend         | Vanilla HTML/CSS/JS   | No build step, runs instantly                   |

---

## 4. Data Model

### Student Record (`students.json`)

```json
{
  "id":         "STU001",            // Unique key, used for folder name
  "name":       "Ahmed Al-Rashidi",
  "department": "Computer Science",
  "year":       2,                   // Academic year (1-5)
  "gender":     "M",
  "dob":        "2003-05-14",
  "phone":      "+966501234567",
  "email":      "ahmed@uni.edu"
}
```

### Student Status (computed at runtime)

```js
{
  ...studentRecord,
  capturedAngles: ["front", "right"],   // Scanned from filesystem
  completed: false                       // true only when capturedAngles.length === 6
}
```

> **Status is never stored** — it is always derived by checking which `.jpg`
> files exist in `photos/<student_id>/`. This means it is always accurate,
> even if files are manually added or deleted on disk.

### Photo File Naming Convention

```
photos/
└── STU001/
    ├── front.jpg     ← Always lowercase angle name
    ├── right.jpg
    ├── left.jpg
    ├── up.jpg
    ├── down.jpg
    └── center.jpg
```

- Filenames are fixed constants — no timestamps, no sequential numbers.
- Retaking a photo simply **overwrites** the existing file (safe — OS file write is atomic).
- Deleting a photo removes the `.jpg` file — the slot becomes available to recapture.

---

## 5. REST API Contract

### `GET /api/students`
Returns all students with computed completion status.

**Response:**
```json
[
  {
    "id": "STU001",
    "name": "Ahmed Al-Rashidi",
    "capturedAngles": ["front", "right"],
    "completed": false
  }
]
```

---

### `GET /api/students/:id`
Returns a single student with status.

---

### `GET /api/photos/:id/:angle`
Serves the raw `.jpg` file directly (binary).
Used for displaying thumbnails in the dashboard.

**Example:** `GET /api/photos/STU001/front`

---

### `POST /api/photo`
Receives a photo upload. This is the **critical path** for photo saving.

**Request:** `multipart/form-data`
| Field      | Type   | Description                         |
|------------|--------|-------------------------------------|
| `studentId`| string | e.g. `"STU001"`                     |
| `angle`    | string | one of `front/right/left/up/down/center` |
| `photo`    | file   | Raw JPEG binary blob from phone     |

**Flow inside the handler:**
```
1. Validate studentId and angle
2. Confirm student exists in database
3. fs.ensureDir(photos/<studentId>/)    ← Creates folder if missing
4. fs.writeFile(photos/<id>/<angle>.jpg, req.file.buffer)
   └── req.file.buffer = raw bytes from Multer memory storage
       └── No re-encoding. No resizing. Written byte-for-byte.
5. Rescan folder to get capturedAngles[]
6. Check if capturedAngles.length === 6 → completed
7. io.emit('photo-saved', payload)      ← Notify ALL clients in real time
8. Return JSON response
```

**Response:**
```json
{
  "success": true,
  "angle": "front",
  "capturedAngles": ["front"],
  "completed": false
}
```

---

### `DELETE /api/photos/:id/:angle`
Deletes a single angle photo so it can be retaken.

---

### `GET /api/qrcode`
Returns the phone URL and a base64 QR code PNG.

**Response:**
```json
{
  "url": "http://192.168.1.105:3000/camera.html",
  "qrDataUrl": "data:image/png;base64,..."
}
```

---

### `GET /api/stats`
Overall progress summary.

**Response:**
```json
{ "total": 100, "completed": 23, "pending": 77 }
```

---

## 6. WebSocket (Socket.io) Event Map

```
                 PC Dashboard                    Phone Camera
                      │                               │
                      │  ──select-student──►          │
                      │    { studentId }              │
                      │                               │
                      │  ◄──student-selected──        │  (server broadcasts)
                      │    { studentId }              │  Phone loads student
                      │                               │
                      │  ──capture-request──►         │  (optional: PC triggers)
                      │    { angle }                  │
                      │                               │
                      │  ◄──camera-ready──            │
                      │                               │
                      │  ◄──photo-saved──             │  (after POST /api/photo)
                      │    { studentId,               │
                      │      angle,                   │
                      │      capturedAngles,          │
                      │      completed }              │
                      │                               │
                      │  ◄──camera-disconnected──     │  Phone closes tab/loses signal
```

**Why Socket.io instead of just polling?**
- Dashboard updates **instantly** without the employee refreshing
- Phone receives student selection **within milliseconds**
- If phone reconnects, server can re-broadcast current state

---

## 7. Photo Quality Pipeline (Phone-Side)

```
Phone Camera (WebRTC)
        │
        │  getUserMedia({ video: { facingMode:'environment',
        │                          width:{ideal:4096},
        │                          height:{ideal:3072} } })
        │
        ▼
  Live Video Feed (HTML <video>)
        │
        ├──── Quality Check Loop (every 700ms) ────────────────────────┐
        │         Sample 128×128 pixel region from video               │
        │         Convert to grayscale                                  │
        │         Apply Laplacian kernel (edge detection)               │
        │         Compute variance of Laplacian output                  │
        │         Variance > 80  → "Sharp" (green dot)                 │
        │         Variance ≤ 80  → "Blurry" (red dot)                 │
        │                                                              │
        │  [Employee taps Capture button]                              │
        │                                                              │
        ├──── Pre-capture Blur Gate ──────────────────────────────────┤
        │         Same Laplacian check on 256×256 sample               │
        │         FAIL → Show blur warning, block upload               │
        │         PASS → Continue                                       │
        │                                                              │
        ▼                                                              │
  canvas.drawImage(videoFeed, 0, 0, videoWidth, videoHeight)          │
        │  ← Full native resolution (e.g. 4000×3000 for 12MP camera) │
        │                                                              │
        ▼                                                              │
  canvas.toBlob(callback, 'image/jpeg', 1.0)                          │
        │  quality = 1.0 = MAXIMUM (no additional compression)        │
        │  Result: Blob of ~2-8MB depending on phone camera           │
        │                                                              │
        ▼                                                              │
  FormData → POST /api/photo (multipart upload)                        │
        │                                                              │
        ▼                                                              │
  Multer stores in memory buffer (no temp files)                       │
        │                                                              │
        ▼                                                              │
  fs.writeFile(path, buffer)  ← Raw bytes written to disk             │
        │  No re-encoding. No resizing. Byte-for-byte original.       │
        │                                                              │
        ▼                                                              │
  photos/STU001/front.jpg  ✓  ──────────────────────────────────────┘
```

### Why `toBlob(cb, 'image/jpeg', 1.0)` is the right call

| What it does NOT do | What it DOES |
|---|---|
| ❌ Does not reduce resolution | ✅ Uses full `videoWidth × videoHeight` |
| ❌ Does not add JPEG artifacts | ✅ quality=1.0 = mathematically lossless JPEG |
| ❌ Does not crop or rotate | ✅ Full sensor frame captured |
| ❌ Does not use a thumbnail | ✅ Reads from live `<video>` frame |

> **Note:** "quality=1.0" in JPEG means the quantization tables are set to minimum
> loss, not truly lossless. For true lossless, PNG would be needed, but JPEG at 1.0
> is visually indistinguishable and produces much smaller files suitable for ID photos.

---

## 8. Blur Detection — Math Explained

The **Laplacian Variance** method detects focus quality:

```
Step 1: Convert RGB pixel → Grayscale
        gray = 0.299R + 0.587G + 0.114B

Step 2: Apply discrete Laplacian kernel (detects edges/sharpness)
        L(x,y) = -gray(x,y-1) - gray(x,y+1) - gray(x-1,y) - gray(x+1,y)
                 + 4 × gray(x,y)

Step 3: Compute variance of L values across all pixels
        Var(L) = mean(L²) - mean(L)²

Step 4: Decision
        Var(L) > 80   → Image is sharp   ✓
        Var(L) ≤ 80   → Image is blurry  ✗
```

**Why this works:** A blurry image has smooth gradients — the Laplacian output
is small everywhere, producing a low variance. A sharp image has strong edges,
high Laplacian response, and therefore high variance.

---

## 9. Face Angle Guide System

| Angle  | Direction | Instruction                     | Arrow |
|--------|-----------|----------------------------------|-------|
| Front  | Neutral   | Look straight ahead              | —     |
| Right  | →         | Turn head to the right           | →     |
| Left   | ←         | Turn head to the left            | ←     |
| Up     | ↑         | Tilt head upward                 | ↑     |
| Down   | ↓         | Tilt head downward               | ↓     |
| Center | ⊕         | Natural posture, slight chin down | ⊕    |

The **SVG oval guide** rendered over the camera viewfinder:
- Shows darkened region outside the oval (keeps focus on face area)
- Corner bracket markers for precise positioning
- Oval border turns **blue** for uncaptured, **green** once saved
- Direction arrow animates in the appropriate quadrant

---

## 10. Student Completion Rules

```
Completion State Machine:

[PENDING] ──── all 6 angles captured ────► [COMPLETED]
    │                                           │
    │◄─── any photo deleted (retake) ───────────┘

Rules enforced:
  1. A student cannot be COMPLETED unless all 6 files exist on disk.
  2. Completion is always re-verified from the filesystem (never from memory alone).
  3. Deleting any photo immediately reverts the student to PENDING.
  4. Duplicate captures simply overwrite the existing file (no data loss).
```

---

## 11. Phone Connection Flow (Step by Step)

```
1. Employee opens Dashboard on PC browser
   → Dashboard loads, fetches /api/students, renders list

2. Employee clicks "Connect Phone" button
   → Dashboard calls GET /api/qrcode
   → Server gets local IP via os.networkInterfaces()
   → Server generates QR code for http://<LAN-IP>:3000/camera.html
   → Dashboard shows QR modal

3. Employee scans QR with phone camera
   → Phone browser opens camera.html
   → Page loads, requests camera permission
   → getUserMedia() starts video stream at max resolution

4. Phone emits 'camera-ready' via Socket.io
   → Dashboard receives it, shows green "Camera Connected" dot

5. Employee selects a student in the dashboard
   → Dashboard emits 'select-student' { studentId }
   → Server broadcasts 'student-selected' to all clients
   → Phone receives it, calls GET /api/students/STU001
   → Phone renders student name, angle pills, sets first uncaptured angle

6. Employee positions student, taps capture on phone
   → Blur gate runs → passes
   → Full-res frame captured to canvas
   → JPEG blob created at quality=1.0
   → POST /api/photo sends blob

7. Server saves photo to photos/STU001/front.jpg
   → Server emits 'photo-saved' to all sockets
   → Dashboard thumbnail updates instantly (no refresh)
   → Phone auto-advances to next uncaptured angle

8. Repeat steps 6-7 for all 6 angles

9. When all 6 done:
   → capturedAngles.length === 6
   → Server emits 'student-completed'
   → Dashboard shows green COMPLETED badge
   → Phone shows 🎉 All 6 photos captured!
   → Employee selects next student → repeat from step 5
```

---

## 12. Safety & Data Integrity Mechanisms

| Risk | Protection |
|---|---|
| **Duplicate capture** | Overwrites same filename — no duplicates possible |
| **Partial completion** | Status re-computed from filesystem — can never lie |
| **Server crash mid-upload** | Multer buffers in memory → writeFile is atomic at OS level |
| **Phone disconnects** | Socket.io auto-reconnects; server re-broadcasts on reconnect |
| **Blurry photo accepted** | Laplacian variance gate blocks upload before it starts |
| **Student folder missing** | `fs.ensureDir()` creates it automatically on every upload |
| **Wrong student selected** | `studentId` is always validated against students.json |
| **Network timeout on upload** | Upload failure shows error toast; photo NOT saved |
| **Marking complete early** | "Mark Complete" button only visible when all 6 files confirmed |

---

## 13. Setup & Run Instructions

### Prerequisites
- **Node.js** v18 or later — [nodejs.org](https://nodejs.org)
- Both PC and Phone on the **same WiFi network**
- Phone browser must support `getUserMedia` (all modern iOS/Android browsers ✓)

### Steps

```bash
# 1. Navigate to project
cd webapp

# 2. Install dependencies
npm install

# 3. Start the server
npm start
#   or for auto-restart on file changes:
npm run dev

# 4. Open dashboard on PC
#   http://localhost:3000

# 5. Open camera on phone
#   Click "Connect Phone" button → scan QR code
```

### Dependencies installed by `npm install`

| Package    | Version | Purpose                          |
|------------|---------|----------------------------------|
| express    | ^4.19   | HTTP server + static files       |
| socket.io  | ^4.7    | WebSocket real-time events       |
| multer     | ^1.4    | Multipart file upload handling   |
| fs-extra   | ^11.2   | Enhanced filesystem operations   |
| qrcode     | ^1.5    | QR code PNG generation           |
| nodemon    | ^3.1    | Dev: auto-restart on file change |

---

## 14. Folder Output Example (After Capturing 3 Students)

```
photos/
├── STU001/
│   ├── front.jpg    (3.2 MB — full 12MP resolution)
│   ├── right.jpg    (3.1 MB)
│   ├── left.jpg     (3.0 MB)
│   ├── up.jpg       (2.9 MB)
│   ├── down.jpg     (3.1 MB)
│   └── center.jpg   (3.2 MB)
├── STU007/
│   ├── front.jpg    (2.8 MB)
│   └── right.jpg    (2.7 MB)   ← Only 2/6 done → still PENDING
└── STU023/
    ├── front.jpg    ...
    ├── right.jpg    ...
    ├── left.jpg     ...
    ├── up.jpg       ...
    ├── down.jpg     ...
    └── center.jpg   ...        ← All 6 done → COMPLETED ✓
```

---

## 15. Extension Points (Future Upgrades)

| Feature | How to Add |
|---|---|
| Import from CSV/Excel | Add `POST /api/import` + use `xlsx` npm package to parse and write `students.json` |
| Export photos as ZIP | Use `archiver` npm package, `GET /api/export/:id` streams a zip |
| Admin login/password | Add express-session + bcrypt for simple auth middleware |
| Face centering check | Use `face-api.js` in browser to detect if face is inside the oval |
| Liveness detection | Add blink/smile prompt between captures |
| Cloud backup | Add S3 upload after every `fs.writeFile` using `@aws-sdk/client-s3` |
| Multi-language UI | Replace hardcoded strings with `i18n` object, add Arabic RTL CSS |
| Custom student fields | Edit `students.json` schema — dashboard renders all fields dynamically |
