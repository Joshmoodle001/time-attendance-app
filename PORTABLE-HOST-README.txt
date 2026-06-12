PORTABLE HOST OVERVIEW

This project can now be packaged into a movable folder that keeps the Electron app and its local host data together.

Portable behavior:
- Electron stores user data, session data, worker settings, and machine identity in portable-data inside the app folder.
- When the folder is copied to a different machine, the app detects the new host and opens the setup checklist again.
- The first-run checklist can mark the machine as the primary report host for the Amber live queue.

Rebuild the folder package:
- Run the package script: npm run package:portable
- The output folder is created under portable-dist\server time and attendance system

Inside the packaged folder:
- Launch Server Time Attendance.bat
- Prepare For New Machine.bat
- resources\app\portable-data

Current note:
- The Amber live site still needs to build and deploy these repo updates before the live queue and shift-sync fixes are available in production.
