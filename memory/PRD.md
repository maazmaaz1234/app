# Shree Vedha College Attendance Management — PRD

## Problem Statement
Build a clean, easy-to-understand mobile attendance app for **one college only (Shree Vedha College)** with:
- Role-based usage (Admin + Student)
- Phone/password authentication
- Student approval by admin
- Semester/subject-wise attendance
- Bulk attendance marking by subject
- Student subject-wise percentage tracking
- Editable college branding (name), logo presence, and developer info

## Architecture
- **Frontend:** Expo React Native (single app, role-based UI)
- **Backend:** FastAPI (`/app/backend/server.py`)
- **Database:** MongoDB (users, semesters, subjects, assignments, attendance, college profile)
- **Auth:** JWT token-based sessions

## User Personas
1. **College Admin**
   - Approves students
   - Creates semesters/subjects
   - Assigns subjects to students
   - Marks bulk attendance by subject
   - Imports CSV data
   - Views student-subject insights
2. **Student**
   - Logs in with phone/password
   - Views attendance history
   - Tracks subject-wise percentage

## Core Requirements (Static)
- One-college system (Shree Vedha)
- No OTP flow (password-only)
- Student login via phone
- Admin login via phone
- Admin forgot-password reset flow (password reset without OTP)
- Logo shown on login/home and themed UI aligned with logo colors
- Insights by **student + subject** (not only course-level)
- Easy bulk attendance: select subject → select present students → others absent

## Implemented (with date)
### 2026-03-14
- Rebuilt backend auth to phone/password model (`admin`/`student` roles)
- Added one-college profile APIs (fetch/update college name)
- Added admin create-admin flow
- Added admin forgot-password reset endpoint (no OTP)
- Added semester and subject management APIs
- Added student-subject assignment API
- Added bulk attendance API by subject/date with present list logic
- Added CSV import API (`student_name,phone_number,password,semester,subjects`)
- Added admin insights API grouped by semester → student → subject percentages
- Added student subjects, attendance history, and subject-insight APIs
- Rebuilt frontend UI for:
  - Phone/password login + signup
  - Forgot admin password UI
  - Admin home/manage/insights/settings/developer tabs
  - Student home/history/insights/settings/developer tabs
  - College logo + updated title text
  - Subject-wise tracking and bulk attendance flow
- Updated app branding in `app.json` and set logo image asset

## Prioritized Backlog
### P0 (Must)
- Optional data cleanup endpoint to remove legacy test/demo records from previous schema
- Add admin-side edit/delete controls for attendance records (if needed for corrections)

### P1 (Should)
- Split large `frontend/app/index.tsx` into modular screens/components
- Add richer form validation (strict date/phone format feedback)
- Add pagination/filter chips for large student and attendance lists

### P2 (Could)
- Export reports (CSV/PDF)
- Push notifications for low attendance
- Enhanced analytics visual charts per semester/subject

## Next Tasks
1. Optional cleanup utility for legacy records.
2. Modularize frontend screens for maintainability.
3. Add stronger validation + UX micro-feedback on forms.
