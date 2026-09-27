# Student Face Photo Capture System

Take passport-style photos of students using a phone as the camera, controlled
from a PC. The phone and the PC talk to each other over your WiFi. Nothing gets
installed on the phone, it just opens a web page.

You pick a student on the PC. The phone switches to that student on its own.
You take five photos. They save straight to the PC at full camera quality.

---

## Which version do you want?

There are two branches in this repo.

**[`main`](../../tree/main) is the ready-to-run version.** Download it, double
click `START.bat`, and it works. You do not need Node.js or anything else. Use
this one if you just want to take photos.

**`source-code` is the code.** You are looking at it now. Use this if you want
to change how the app works.

---

## What it does

- Keeps a list of students and shows who is done and who is not
- Pairs your phone as the camera by scanning a QR code
- Takes five angles of each face: front, right, left, up, down
- Shows the phone's camera live on the PC screen while you work
- Saves photos at the phone's full resolution, with no quality loss
- Warns you and refuses to save if a photo came out blurry
- Gives every student their own folder, named after them
- Lets you delete and retake any photo, even after all five are done
- Lets you add and remove students without touching any files
- Search by name, ID or department, and filter by done or pending

A student counts as finished only when all five photos are really on disk. The
app checks the files themselves, so the count cannot drift out of step.

---

## Running the ready-made version

1. Download the `main` branch and unzip it somewhere.
2. Double click `START.bat`.
3. The first time, Windows asks for permission. Say yes. This lets phones reach
   the app and stops the browser from warning you about the connection.
4. Your browser opens on its own.

Keep the black window open while you work. Closing it stops the app.

---

## Running from source

You need Node.js, the LTS version from [nodejs.org](https://nodejs.org).

```bash
npm install
npm start
```

You will see something like this:

```
Dashboard : https://localhost:3000
Phone URL : https://192.168.0.168:3000/camera.html
```

Open the dashboard address in your browser.

On Windows you can use `START.bat` instead. It does the same thing and also
sorts out the firewall and the certificate for you.

---

## Using your phone as the camera

The phone must be on the **same WiFi as the PC**. This will not work over mobile
data.

1. On the PC, click **Connect Phone**. A QR code appears.
2. Scan it with the phone's camera app and open the link.
3. The phone asks to use its camera. Allow it.
4. Pick a student on the PC. The phone switches to that student by itself.
5. Take the photos. You can press **Capture** on the PC or the round button on
   the phone. Both do the same thing.

While the phone is connected, the PC shows what the phone camera sees, so you
can check the framing without looking at the phone.

### Your phone says the connection is not secure

That is expected the first time, and it needs fixing properly, because most
phone browsers will not allow camera access on a page they do not trust. The
page may load fine but the camera stays black.

To fix it for good, open this address on the phone:

```
https://<the address shown in the black window>:3000/cert.crt
```

A file downloads. Install it as a **CA certificate**. On Android that is under
Settings, Security, Encryption & credentials, Install a certificate, CA
certificate. Picking the wrong type there is the usual reason this seems not to
work.

After that, reload the camera page and the camera will work.

If something is still wrong, the phone page now tells you what, instead of just
sitting there blank.

---

## Why the app uses HTTPS

Browsers only allow camera access on a secure connection. So the app serves
everything over HTTPS.

It makes its own certificate the first time it starts. That certificate covers
`localhost` and whatever address your PC has on the network right now. It is
kept in `data/certs`.

If you move to a different WiFi, your PC's address changes. The app notices this
when it next starts and makes a new certificate to match. You do not have to do
anything, but you do have to restart it after changing networks.

`START.bat` installs the certificate on the PC so your browser stops warning
you, and adds a firewall rule for port 3000 so phones can reach the app. Both
happen once, on the first run.

---

## Where the photos go

Each student gets a folder named after them, with their ID in brackets:

```
photos/
  Aairah Adeena Rahman (003-26-0080)/
    front.jpg
    right.jpg
    left.jpg
    up.jpg
    down.jpg
```

The ID is always included, because two students can have the same name. Without
it, one would quietly overwrite the other's photos.

Where that `photos` folder lives depends on how you run the app:

| How you run it | Where photos go |
|---|---|
| From source | inside the project folder |
| The ready-made version | `Documents\PhotoBooth` |
| With `PORTABLE.txt` present | the app's own folder |

**Portable mode** is useful for a USB stick. Put an empty file called
`PORTABLE.txt` next to the program. Everything, the student list and the photos,
then stays in that folder and travels with the drive. Plug it into any PC and
carry on where you left off.

You can also point the app anywhere you like, such as a shared drive, by setting
an environment variable called `PHOTOBOOTH_HOME` to that path.

The app tells you where it is saving when it starts, so you never have to guess.

---

## Managing students

**To add one**, click **+ Add** in the sidebar. ID and name are required. Phone,
email, department, year and date of birth are optional.

**To remove one**, select them and click **Delete** at the top right of their
details. This also deletes their photos, and it cannot be undone.

**To load a list you already have**, put your `students.json` in the `data`
folder and restart the app. It looks like this:

```json
[
  {
    "id": "003-26-0001",
    "name": "Example Student",
    "phone": "01700000000",
    "email": "example@school.edu",
    "department": "Spark Education",
    "year": "2026",
    "dob": "2010-01-01"
  }
]
```

Only `id` and `name` are needed. IDs must be unique. There is a sample in
`data/students.example.json`.

The real student list is not in this repo on purpose. It holds names, phone
numbers and email addresses, and that should not sit in a public place.

---

## Retaking a photo

Every photo you have taken has a **Retake** button on it. Click it, confirm, and
that photo is deleted so you can take it again.

This works at any point, including after all five are done. The student simply
goes back to pending until you retake the missing one. You can redo one angle or
all five.

---

## Photo quality

| | |
|---|---|
| Size | whatever the camera can do, often 3024 x 4032 on a 12 MP phone |
| Format | JPEG at maximum quality |
| Sharpness | blurry shots are rejected before they are saved |
| Processing | none, the file is written exactly as the camera produced it |

The small live preview on the PC is only there so you can see the framing. It
does not affect the photos you take.

---

## When something goes wrong

**The student list just says "Loading..." forever.**
The app is not running. Look for the black window. If it is not there, start it
again with `START.bat`, then reload the page.

**The phone cannot open the page at all.**
Check both devices are on the same WiFi. Then check you approved the Windows
permission prompt the first time you ran it. Run `START.bat` again and say yes
if you are not sure.

**The phone page opens but the camera is black.**
The phone does not trust the certificate yet, so the browser is blocking the
camera. Install the certificate as described above. The phone page will also
tell you this itself.

**You changed WiFi and now the phone cannot connect.**
Your PC has a new address. Restart the app, then scan the new QR code.

**Photos are not where you expected.**
Look at the black window when the app starts. It prints the exact folder.

---

## Project layout

```
server.js               the server
package.json            dependencies and build settings
data/
  students.json         your student list (not in this repo)
  students.example.json what the format looks like
  certs/                the HTTPS certificate, made automatically
photos/                 captured photos, one folder per student
public/
  index.html            the PC dashboard
  camera.html           the phone camera page
  css/                  styles for both
  js/                   dashboard.js and camera.js
```

---

## API

| Method | Path | What it does |
|---|---|---|
| `GET` | `/api/students` | every student, with what has been captured |
| `GET` | `/api/students/:id` | one student |
| `POST` | `/api/students` | add a student |
| `DELETE` | `/api/students/:id` | remove a student and their photos |
| `GET` | `/api/photos/:id/:angle` | fetch one photo |
| `POST` | `/api/photo` | upload a photo |
| `DELETE` | `/api/photos/:id/:angle` | delete one photo, for a retake |
| `GET` | `/api/qrcode` | the QR code for pairing a phone |
| `GET` | `/api/info` | address, port and the list of angles |
| `GET` | `/cert.crt` | the certificate, to install on a phone |

Live updates run over Socket.io.

The dashboard sends `select-student` and `capture-request`. The phone sends
`camera-ready`, `preview-frame` and `capture-failed`. The server passes on
`student-selected`, `student-updated`, `student-deleted`, `photo-saved`,
`photo-deleted`, `camera-ready` and `camera-disconnected`.

---

## Building the Windows program

```bash
npm install --no-save pkg terser
node node_modules/pkg/lib-es5/bin.js . --targets node18-win-x64 --output dist/PhotoBooth.exe
```

The web pages and the Socket.io browser file are packed inside the program, so
it runs on its own with no other files needed.

If you put a `public` folder next to the program, that one is used instead. It
is a quick way to change the look without rebuilding.

---

## Built with

express, socket.io, multer, fs-extra, qrcode, selfsigned
