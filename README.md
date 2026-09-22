# Student Face Photo Capture System 
 
A passport-office-style web app for capturing original-quality student face photos 
using a phone camera, managed from a PC dashboard over local WiFi. 
 
--- 
 
## Features 
 
- Preloaded student database (100 students: name, ID, dept, year, DOB, email, phone) 
- Live progress tracking (e.g. 45 / 100 completed) 
- Phone connects as camera via QR code, no app install needed 
- 6 required face angles: Front, Right, Left, Up, Down, Center 
- Face-positioning guide overlay shown for each angle 
- Blur detection: rejects blurry photos before saving 
- Original quality: full native phone camera resolution, JPEG quality=1.0 
- Auto folder per student named by student ID 
- Real-time sync: dashboard updates the instant phone saves a photo 
- Search and filter by name, ID, department; filter Pending / Completed 
- Retake any angle without losing other captured photos 
- Student only marked Completed when all 6 photos are confirmed on disk 
 
--- 
 
## How It Works 
 
  PC Browser (Dashboard)  WebSocket  Phone Browser (Camera) 
         connected via Express Server on Port 3000 
         Photos saved to: photos/STU001/front.jpg, right.jpg ... 
 
1. Run the server on your PC 
2. Open the dashboard in a PC browser at http://localhost:3000 
3. Click Connect Phone, scan the QR code with your phone 
4. Select a student on PC, phone auto-loads that student 
5. Capture 6 angle photos on the phone 
6. Photos save at full resolution to photos/student_id/ 
7. Dashboard marks student Completed automatically 
 
--- 
 
## Project Structure 
 
  webapp/ 
  README.md              (You are here) 
  BLUEPRINT.md           (Full technical pipeline reference) 
  package.json           (Node.js dependencies) 
  server.js              (Express + Socket.io server) 
  data/ 
    students.json        (Student database - edit to add real students) 
  photos/                (Auto-created. One subfolder per student.) 
    STU001/ 
      front.jpg 
      right.jpg 
      left.jpg 
      up.jpg 
      down.jpg 
      center.jpg 
  public/ 
    index.html           (PC Dashboard) 
    camera.html          (Phone Camera view) 
    css/ 
      dashboard.css 
      camera.css 
    js/ 
      dashboard.js 
      camera.js 
 
--- 
 
## Quick Start 
 
Step 1: Install Node.js 
  Download from https://nodejs.org (LTS version) 
  Install it, then restart your terminal. 
 
Step 2: Install dependencies 
  cd D:\projects\webapp 
  npm install 
 
Step 3: Start the server 
  npm start 
 
  You will see: 
  Dashboard : http://localhost:3000 
  Phone URL : http://192.168.x.x:3000/camera.html 
 
Step 4: Open http://localhost:3000 in your PC browser 
 
Step 5: Click Connect Phone, scan QR code with phone 
  Phone and PC must be on the SAME WiFi network. 
 
--- 
 
## Face Angles 
 
  Front   - Look straight ahead at the camera 
  Right   - Turn head to the right 
  Left    - Turn head to the left 
  Up      - Tilt head slightly upward 
  Down    - Tilt head slightly downward 
  Center  - Natural posture, slight chin down 
 
--- 
 
## Student Database 
 
Edit data/students.json to add your real students. 
Each record needs: id, name, department, year, gender, dob, phone, email 
The id field is used as the photo folder name. Keep it unique. 
 
--- 
 
## Photo Quality 
 
  Resolution : Full native phone camera resolution (e.g. 4000x3000 for 12MP) 
  Format     : JPEG at quality=1.0 (maximum, no added compression) 
  Blur gate  : Photos rejected if Laplacian variance score is below threshold 
  Storage    : Raw bytes written directly to disk, no server-side re-encoding 
 
--- 
 
## API Endpoints 
 
  GET    /api/students           All students with completion status 
  GET    /api/students/:id        Single student 
  GET    /api/photos/:id/:angle   Serve a captured photo 
  POST   /api/photo              Upload a photo (multipart) 
  DELETE /api/photos/:id/:angle  Delete a photo for retake 
  GET    /api/qrcode             QR code PNG for phone pairing 
  GET    /api/stats              Overall completion stats 
 
--- 
 
## Dependencies 
 
  express    - HTTP server and static files 
  socket.io  - Real-time WebSocket events 
  multer     - Multipart photo upload handling 
  fs-extra   - Filesystem operations 
  qrcode     - QR code generation 
 
--- 
 
## Full Technical Reference 
 
See BLUEPRINT.md for complete pipeline documentation including: 
  - Architecture diagram 
  - WebSocket event map 
  - Photo pipeline and quality math 
  - Blur detection algorithm (Laplacian variance) 
  - Completion state machine 
  - Safety and data integrity mechanisms 
  - Extension points for future upgrades
