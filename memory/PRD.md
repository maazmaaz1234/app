# Shree Vedha College Attendance Management — PRD

## Problem Statement
Build a professional, blue-themed mobile attendance app for **one college only (Shree Vedha College)** with:
- Role-based usage (Admin + Student)
- Phone/password authentication (no OTP)
- Course → Subject → Student structure (no semester)
- Student approval + profile/password management by admin
- Bulk attendance by subject
- Editable/deletable course, subject, student, and attendance records
- Admin password confirmation for destructive actions
- Admin notification center for student changes
- Student profile picture upload + student password change

## Architecture
- **Frontend:** Expo React Native (single app, role-based UI)
- **Backend:** FastAPI (`/app/backend/server.py`)
- **Database:** MongoDB (users, courses, subjects, assignments, attendance, notifications, college profile)
- **Auth:** JWT token-based sessions

## User Personas
1. **College Admin**
   - Approves students
   - Creates courses/subjects
   - Assigns subjects to students
   - Marks bulk attendance by subject
   - Changes/deletes students, courses, subjects, attendance
   - Changes student passwords
   - Monitors notification center
   - Views course → student → subject insights
2. **Student**
   - Logs in with phone/password
   - Uploads profile picture
   - Changes own password
   - Views attendance history
   - Tracks subject-wise percentage

## Core Requirements (Static)
- One-college system (Shree Vedha)
- No OTP flow (password-only)
- Student login via phone
- Admin login via phone
- Forgot-password not on login; hidden admin reset inside settings
- Logo shown on login/home and themed UI aligned with logo colors
- Insights by **course → student → subject** with attendance calendar detail
- Easy bulk attendance: select subject → select present students → others absent
- Student profile updates trigger admin notifications
- Admin password required for delete operations

## Implemented (with date)
### 2026-03-14
- Re-architected backend from semester model to **course model**:
  - Course CRUD
  - Subject CRUD linked to course
  - Student records linked to course
- Added secure admin operations:
  - Delete course/subject/student/attendance with admin password
  - Admin change student password
  - Admin update student profile (name/course/photo)
- Added attendance controls:
  - Bulk subject attendance
  - Edit existing attendance status
  - Delete attendance entry with admin password
- Added insights + notifications:
  - Admin insights: course → student → subject percentages + calendar text
  - Notification center for student profile/password updates
  - Notification read endpoint
- Added student self-service:
  - Profile update (name/photo)
  - Password change
- Added full reset flow:
  - `/api/admin/reset-all` wipes all records and reseeds default admin
  - Executed reset to leave system fresh
- Frontend rebuilt into modular main app component (`components/MainApp.tsx`)
- Removed CSV option and removed semester UI
- Blue professional palette updated and app logo retained
- Added image picker integration (`expo-image-picker`) for profile images
- Added explicit testIDs for automation-critical controls

## Prioritized Backlog
### P0 (Must)
- Add confirmation modals before destructive actions (delete/reset)
- Add stronger password policy + validation messages in UI

### P1 (Should)
- Add richer calendar visualization UI in insights tab
- Add per-course filter controls in notifications and insights screens
- Add loading placeholders and optimistic updates for heavy lists

### P2 (Could)
- Export reports (CSV/PDF)
- Push alerts for low attendance thresholds
- Parent/guardian notification workflow

## Next Tasks
1. Add confirmation dialogs for delete/reset actions.
2. Add richer calendar UI under admin insights.
3. Add stricter validation and improved inline error UX.
