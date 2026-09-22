const express = require('express');
const https = require('https');
const crypto = require('crypto');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const QRCode = require('qrcode');
const selfsigned = require('selfsigned');

const app = express();
let io; // assigned once the HTTPS server + certificate are ready (see bottom)

const PORT = process.env.PORT || 3000;
const ANGLES = ['front', 'right', 'left', 'up', 'down'];

// Two separate roots:
//   APP_DIR   - where the program and its web files live (read-only)
//   STORE_DIR - where photos and the student list are kept
// Packaged, the store goes to one fixed, easy-to-find place in Documents, so
// photos never depend on where the program was copied to. Set PHOTOBOOTH_HOME
// to override (e.g. a shared network drive).
const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const STORE_DIR = process.env.PHOTOBOOTH_HOME
  || (process.pkg ? path.join(os.homedir(), 'Documents', 'PhotoBooth') : __dirname);

const DATA_DIR = path.join(STORE_DIR, 'data');
const PHOTOS_DIR = path.join(STORE_DIR, 'photos');
const CERTS_DIR = path.join(DATA_DIR, 'certs');
const STUDENTS_FILE = path.join(DATA_DIR, 'students.json');

// Ensure directories exist
fs.ensureDirSync(PHOTOS_DIR);
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(CERTS_DIR);

// First run only: copy any student list / photos shipped alongside the program
// into the store. Never overwrites work already captured on this machine.
function seedStore() {
  if (!process.pkg) return;   // in development the project folder IS the store
  // Portable mode keeps the store in the program's own folder, so the files
  // are already where they belong and copying would target itself.
  if (path.resolve(APP_DIR) === path.resolve(STORE_DIR)) return;
  try {
    const seedList = path.join(APP_DIR, 'data', 'students.json');
    if (fs.existsSync(seedList) && !fs.existsSync(STUDENTS_FILE)) {
      fs.copySync(seedList, STUDENTS_FILE);
      console.log('Loaded the student list supplied with the program.');
    }
    const seedPhotos = path.join(APP_DIR, 'photos');
    if (fs.existsSync(seedPhotos) && fs.readdirSync(PHOTOS_DIR).length === 0) {
      fs.copySync(seedPhotos, PHOTOS_DIR);
      console.log('Copied the photos supplied with the program.');
    }
  } catch (e) {
    console.error('Could not copy the supplied data:', e.message);
  }
}
seedStore();

// Load students
let students = [];
try {
  // Strip a UTF-8 BOM — editors like Notepad add one and JSON.parse rejects it.
  students = JSON.parse(fs.readFileSync(STUDENTS_FILE, 'utf-8').replace(/^﻿/, ''));
  console.log(`Loaded ${students.length} students.`);
} catch (e) {
  if (e.code === 'ENOENT') console.log('No student list yet - add students from the dashboard.');
  else console.error('Could not read students.json:', e.message);
}

// Get local IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Phone/browser camera access requires a secure context. Generate (and cache)
// a self-signed certificate covering localhost + the current LAN IP so the
// dashboard and camera page can both be served over HTTPS.
async function getCertificate(ip) {
  const keyPath = path.join(CERTS_DIR, 'key.pem');
  const certPath = path.join(CERTS_DIR, 'cert.pem');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const cert = fs.readFileSync(certPath, 'utf-8');
    const key = fs.readFileSync(keyPath, 'utf-8');
    const san = new crypto.X509Certificate(cert).subjectAltName || '';
    if (san.includes(`IP Address:${ip}`)) return { key, cert };
  }

  const pems = await selfsigned.generate([{ name: 'commonName', value: ip }], {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        { type: 7, ip }
      ]
    }]
  });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

// Photos live in a folder named "Student Name (ID)". The ID is always included
// because two students can share a name — without it, one would silently
// overwrite the other's photos. Characters Windows rejects are stripped.
function sanitizeName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
}

function studentFolder(student) {
  const name = sanitizeName(student.name);
  const id = sanitizeName(student.id) || 'unknown';
  return name ? `${name} (${id})` : id;
}

// Resolves through the roster, so a request can never steer the path itself.
// The containment check is a backstop in case a name/ID ever slips sanitizing.
function studentDir(studentId) {
  const student = students.find(s => s.id === studentId);
  if (!student) return null;
  const dir = path.join(PHOTOS_DIR, studentFolder(student));
  return dir.startsWith(PHOTOS_DIR + path.sep) ? dir : null;
}

// Get captured angles for a student (from filesystem)
function getCapturedAngles(studentId) {
  const dir = studentDir(studentId);
  if (!dir) return [];
  return ANGLES.filter(angle => fs.existsSync(path.join(dir, `${angle}.jpg`)));
}

// Multer: store in memory for full-quality write
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max per image
});

app.use(express.json());
// Packaged, the web files are embedded in the program itself (__dirname points
// inside it). A public folder placed next to the program still wins, so the
// look can be changed without a rebuild.
const EXTERNAL_PUBLIC = path.join(APP_DIR, 'public');
const PUBLIC_DIR = fs.existsSync(EXTERNAL_PUBLIC) ? EXTERNAL_PUBLIC : path.join(__dirname, 'public');

// Serves the web files. Deliberately not express.static: when embedded in the
// packaged program the files live in a virtual filesystem that only
// readFileSync can reach, which express.static does not use.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon'
};

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const rel = req.path === '/' ? 'index.html' : decodeURIComponent(req.path).replace(/^[\\/]+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  // Never serve outside the web folder, whatever the request asks for.
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return next();
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
    res.type(MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.send(fs.readFileSync(file));
  } catch { next(); }
});

// API Routes

// GET all students with completion status
app.get('/api/students', (req, res) => {
  const studentsWithStatus = students.map(student => {
    const capturedAngles = getCapturedAngles(student.id);
    return {
      ...student,
      capturedAngles,
      completed: capturedAngles.length === ANGLES.length
    };
  });
  res.json(studentsWithStatus);
});

// GET single student
app.get('/api/students/:id', (req, res) => {
  const student = students.find(s => s.id === req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });
  const capturedAngles = getCapturedAngles(student.id);
  res.json({ ...student, capturedAngles, completed: capturedAngles.length === ANGLES.length });
});

// POST add new student
app.post('/api/students', async (req, res) => {
  try {
    const { id, name, phone, email, department, year, dob } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'ID and Name are required' });
    if (students.find(s => s.id === id)) return res.status(400).json({ error: 'Student ID already exists' });

    const newStudent = {
      id, name,
      phone: phone || 'N/A',
      email: email || '',
      department: department || 'Spark Education',
      year: year || '',
      dob: dob || ''
    };
    students.push(newStudent);
    await fs.writeJson(STUDENTS_FILE, students, { spaces: 2 });
    
    io.emit('student-updated', { studentId: id, capturedAngles: [], student: newStudent });
    res.json({ success: true, student: newStudent });
  } catch (err) {
    console.error('Error adding student:', err);
    res.status(500).json({ error: 'Could not add student' });
  }
});

// DELETE a student (and their captured photos)
app.delete('/api/students/:id', async (req, res) => {
  const { id } = req.params;
  const idx = students.findIndex(s => s.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Student not found' });

  try {
    const dir = studentDir(id);   // resolve before removing them from the roster
    students.splice(idx, 1);
    await fs.writeJson(STUDENTS_FILE, students, { spaces: 2 });
    await fs.remove(dir);

    io.emit('student-deleted', { studentId: id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting student:', err);
    res.status(500).json({ error: 'Could not delete student' });
  }
});

// GET photo for a student/angle
app.get('/api/photos/:id/:angle', (req, res) => {
  const { id, angle } = req.params;
  const dir = studentDir(id);
  if (!dir || !ANGLES.includes(angle)) return res.status(404).json({ error: 'Photo not found' });
  const filePath = path.join(dir, `${angle}.jpg`);
  if (fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'Photo not found' });
  }
});

// POST upload a photo
app.post('/api/photo', upload.single('photo'), async (req, res) => {
  try {
    const { studentId, angle } = req.body;

    if (!studentId || !angle || !ANGLES.includes(angle)) {
      return res.status(400).json({ error: 'Invalid studentId or angle' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No photo data provided' });
    }

    // Create student directory (named after the student)
    const dir = studentDir(studentId);
    if (!dir) return res.status(404).json({ error: 'Student not found' });
    await fs.ensureDir(dir);

    // Write full-quality image buffer directly to disk
    const filePath = path.join(dir, `${angle}.jpg`);
    await fs.writeFile(filePath, req.file.buffer);

    const capturedAngles = getCapturedAngles(studentId);
    const completed = capturedAngles.length === ANGLES.length;

    const payload = { studentId, angle, capturedAngles, completed };
    io.emit('photo-saved', payload);
    res.json({ success: true, ...payload });
  } catch (err) {
    console.error('Error saving photo:', err);
    res.status(500).json({ error: 'Server error saving photo' });
  }
});

// DELETE a specific photo (retake support)
app.delete('/api/photos/:id/:angle', async (req, res) => {
  const { id, angle } = req.params;
  if (!ANGLES.includes(angle)) return res.status(400).json({ error: 'Invalid angle' });
  const dir = studentDir(id);
  if (!dir) return res.status(404).json({ error: 'Student not found' });
  try {
    await fs.remove(path.join(dir, `${angle}.jpg`));
    const capturedAngles = getCapturedAngles(id);
    io.emit('photo-deleted', { studentId: id, angle, capturedAngles, completed: false });
    res.json({ success: true, capturedAngles });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete photo' });
  }
});

// GET QR code for phone camera URL
app.get('/api/qrcode', async (req, res) => {
  const ip = getLocalIP();
  const url = `https://${ip}:${PORT}/camera.html`;
  try {
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 320,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' }
    });
    res.json({ url, qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Download the certificate so a phone can trust it and stop warning.
// Install via Settings > Security > Install a certificate > CA certificate.
app.get('/cert.crt', (req, res) => {
  const certPath = path.join(CERTS_DIR, 'cert.pem');
  if (!fs.existsSync(certPath)) return res.status(404).send('Certificate not found');
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="photobooth.crt"');
  res.sendFile(certPath);
});

// GET server info
app.get('/api/info', (req, res) => {
  const ip = getLocalIP();
  res.json({
    ip,
    port: PORT,
    cameraUrl: `https://${ip}:${PORT}/camera.html`,
    totalStudents: students.length,
    angles: ANGLES
  });
});

// Socket.io

function registerSocketHandlers() {
  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // PC dashboard selects a student -> broadcast to all phones
    socket.on('select-student', ({ studentId }) => {
      console.log(`[Socket] Student selected: ${studentId}`);
      io.emit('student-selected', { studentId });
    });

    // PC requests capture of specific angle from phone
    socket.on('capture-request', ({ angle }) => {
      io.emit('capture-request', { angle });
    });

    // Phone says it's ready / active. Remember which sockets are phones so a
    // dashboard tab closing is not mistaken for the camera going away.
    socket.on('camera-ready', () => {
      socket.data.isPhone = true;
      io.emit('camera-ready');
    });

    // Live preview frames: phone -> dashboard, relayed as-is.
    socket.on('preview-frame', (frame) => socket.broadcast.emit('preview-frame', frame));

    // Phone could not take the shot (e.g. blur gate) — tell the dashboard.
    socket.on('capture-failed', (data) => socket.broadcast.emit('capture-failed', data));

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
      if (socket.data.isPhone) io.emit('camera-disconnected');
    });
  });
}

// Start Server

(async () => {
  const ip = getLocalIP();
  const { key, cert } = await getCertificate(ip);

  // Used by START.bat: create/refresh the certificate, then exit so it can be
  // installed as trusted before the server actually starts.
  if (process.argv.includes('--certs-only')) return;

  const server = https.createServer({ key, cert }, app);
  io = socketIo(server);
  registerSocketHandlers();

  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n==============================================');
    console.log('      Student Face Photo Capture System       ');
    console.log('==============================================');
    console.log(`     Dashboard : https://localhost:${PORT}        `);
    console.log(`     Phone URL : https://${ip}:${PORT}/camera.html  `);
    console.log('----------------------------------------------');
    console.log('  Photos are saved in:');
    console.log(`     ${PHOTOS_DIR}`);
    console.log('----------------------------------------------');
    console.log(`  To stop the phone's security warning, open on the phone:`);
    console.log(`     https://${ip}:${PORT}/cert.crt   and install it`);
    console.log('==============================================\n');
  });
})();
