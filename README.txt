PhotoBooth - Student Photo Capture
===================================

Captures 5 face angles (front, right, left, up, down) for each
student, using a phone or a PC webcam as the camera.


HOW TO RUN
----------
Double-click  START.bat

The first run asks for Windows permission once. Approve it - this
lets phones connect and stops the browser security warning.
Everything after that is automatic.

The dashboard opens in your browser by itself.
Close the black window to stop the program.

Nothing needs installing. Windows 10 or 11 only.


WHERE ARE MY PHOTOS?
--------------------
   Documents\PhotoBooth\photos

Each student gets a folder named "Student Name (ID)" holding
front.jpg, right.jpg, left.jpg, up.jpg and down.jpg, saved at the
camera's full resolution.

The student list is kept in Documents\PhotoBooth\data.
This location stays the same wherever you copy the program to.


KEEPING EVERYTHING IN ONE FOLDER (USB STICK)
--------------------------------------------
Create an empty file named  PORTABLE.txt  next to PhotoBooth.exe.

The student list and photos are then kept inside this folder
instead of Documents, so the whole thing travels on the drive.
Plug it into any PC, run START.bat, and the work stays together.

Delete PORTABLE.txt to go back to normal.


ADDING STUDENTS
---------------
Click "+ Add" in the dashboard sidebar and fill in the details.

Have a list already? Put your students.json into
   Documents\PhotoBooth\data\
and restart the program.


USING A PHONE AS THE CAMERA
---------------------------
1. Connect the phone to the SAME WiFi as this PC.
2. On the dashboard click "Connect Phone" and scan the QR code.
3. Allow camera access on the phone.
4. Pick a student on the PC - the phone follows automatically.
5. Press Capture on the PC, or the shutter on the phone.

The PC shows a live view of what the phone camera sees.

To stop the phone's security warning for good, open the cert.crt
address shown in the black window on the phone and install it.
Otherwise just tap Advanced > Proceed once per session.


IF PHONES CANNOT CONNECT
------------------------
Both devices must be on the same WiFi network, and the Windows
permission prompt on first run must have been approved. Run
START.bat again and approve it to fix this.
