import time
import uuid

import pytest


# Covers auth, approval, semester/course CRUD-like flows, attendance history edit/delete, and analytics.
def test_attendance_management_role_workflow(api_client, base_url):
    tag = f"TEST_{uuid.uuid4().hex[:8]}"
    college_name = f"{tag}_College"

    admin_email = f"{tag.lower()}_admin@example.com"
    student_email = f"{tag.lower()}_student@example.com"
    password = "testpass123"

    admin_signup = api_client.post(
        f"{base_url}/api/auth/signup",
        json={
            "name": "TEST Admin",
            "email": admin_email,
            "password": password,
            "role": "college",
            "college_name": college_name,
        },
    )
    assert admin_signup.status_code == 200
    admin_signup_data = admin_signup.json()
    assert admin_signup_data["user"]["role"] == "college"
    assert admin_signup_data["user"]["approved"] is True

    admin_login = api_client.post(
        f"{base_url}/api/auth/login",
        json={"email": admin_email, "password": password},
    )
    assert admin_login.status_code == 200
    admin_token = admin_login.json()["access_token"]
    admin_user_id = admin_login.json()["user"]["user_id"]
    assert admin_token

    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    student_signup = api_client.post(
        f"{base_url}/api/auth/signup",
        json={
            "name": "TEST Student",
            "email": student_email,
            "password": password,
            "role": "student",
            "college_name": college_name,
        },
    )
    assert student_signup.status_code == 200
    student_signup_data = student_signup.json()
    assert student_signup_data["user"]["role"] == "student"
    assert student_signup_data["user"]["approved"] is False

    student_login_pre_approval = api_client.post(
        f"{base_url}/api/auth/login",
        json={"email": student_email, "password": password},
    )
    assert student_login_pre_approval.status_code == 200
    student_pending_token = student_login_pre_approval.json()["access_token"]
    student_id = student_login_pre_approval.json()["user"]["user_id"]

    student_pending_analytics = api_client.get(
        f"{base_url}/api/student/analytics",
        headers={"Authorization": f"Bearer {student_pending_token}"},
    )
    assert student_pending_analytics.status_code == 403

    pending_students = api_client.get(f"{base_url}/api/admin/pending-students", headers=admin_headers)
    assert pending_students.status_code == 200
    pending_data = pending_students.json()
    assert any(item["user_id"] == student_id for item in pending_data)

    approve_student = api_client.post(
        f"{base_url}/api/admin/approve-student/{student_id}", headers=admin_headers
    )
    assert approve_student.status_code == 200
    assert approve_student.json()["message"] == "Student approved"

    approved_students = api_client.get(f"{base_url}/api/admin/students", headers=admin_headers)
    assert approved_students.status_code == 200
    approved_data = approved_students.json()
    assert any(item["user_id"] == student_id and item["approved"] is True for item in approved_data)

    semester_name = f"{tag}_Sem1"
    create_semester = api_client.post(
        f"{base_url}/api/admin/semesters",
        headers=admin_headers,
        json={"name": semester_name},
    )
    assert create_semester.status_code == 200
    semester_id = create_semester.json()["semester_id"]
    assert create_semester.json()["name"] == semester_name

    get_semesters = api_client.get(f"{base_url}/api/admin/semesters", headers=admin_headers)
    assert get_semesters.status_code == 200
    semesters_data = get_semesters.json()
    assert any(item["semester_id"] == semester_id for item in semesters_data)

    create_course = api_client.post(
        f"{base_url}/api/admin/courses",
        headers=admin_headers,
        json={"semester_id": semester_id, "name": f"{tag}_Math", "code": f"{tag[:4]}101"},
    )
    assert create_course.status_code == 200
    course_id = create_course.json()["course_id"]
    assert create_course.json()["semester_id"] == semester_id

    get_courses = api_client.get(f"{base_url}/api/admin/courses", headers=admin_headers)
    assert get_courses.status_code == 200
    courses_data = get_courses.json()
    assert any(item["course_id"] == course_id for item in courses_data)

    date_value = "2026-01-15"
    mark_attendance = api_client.post(
        f"{base_url}/api/admin/attendance/mark",
        headers=admin_headers,
        json={
            "course_id": course_id,
            "student_id": student_id,
            "date": date_value,
            "status": "present",
        },
    )
    assert mark_attendance.status_code == 200
    attendance_record = mark_attendance.json()
    record_id = attendance_record["record_id"]
    assert attendance_record["status"] == "present"

    get_attendance = api_client.get(
        f"{base_url}/api/admin/attendance?course_id={course_id}&student_id={student_id}",
        headers=admin_headers,
    )
    assert get_attendance.status_code == 200
    attendance_data = get_attendance.json()
    matched_record = next((item for item in attendance_data if item["record_id"] == record_id), None)
    assert matched_record is not None
    assert matched_record["date"] == date_value

    update_attendance = api_client.put(
        f"{base_url}/api/admin/attendance/{record_id}",
        headers=admin_headers,
        json={"status": "absent"},
    )
    assert update_attendance.status_code == 200
    assert update_attendance.json()["status"] == "absent"

    get_attendance_after_update = api_client.get(
        f"{base_url}/api/admin/attendance?course_id={course_id}&student_id={student_id}",
        headers=admin_headers,
    )
    assert get_attendance_after_update.status_code == 200
    refreshed = next(
        (item for item in get_attendance_after_update.json() if item["record_id"] == record_id),
        None,
    )
    assert refreshed is not None
    assert refreshed["status"] == "absent"

    admin_analytics = api_client.get(f"{base_url}/api/admin/analytics", headers=admin_headers)
    assert admin_analytics.status_code == 200
    admin_analytics_data = admin_analytics.json()
    assert admin_analytics_data["overall_total"] >= 1
    assert isinstance(admin_analytics_data["courses"], list)

    student_login_post_approval = api_client.post(
        f"{base_url}/api/auth/login",
        json={"email": student_email, "password": password},
    )
    assert student_login_post_approval.status_code == 200
    student_token = student_login_post_approval.json()["access_token"]
    student_headers = {"Authorization": f"Bearer {student_token}"}

    student_courses = api_client.get(f"{base_url}/api/student/courses", headers=student_headers)
    assert student_courses.status_code == 200
    assert any(item["course_id"] == course_id for item in student_courses.json())

    student_attendance = api_client.get(f"{base_url}/api/student/attendance", headers=student_headers)
    assert student_attendance.status_code == 200
    assert any(item["record_id"] == record_id for item in student_attendance.json())

    student_analytics = api_client.get(f"{base_url}/api/student/analytics", headers=student_headers)
    assert student_analytics.status_code == 200
    student_analytics_data = student_analytics.json()
    assert student_analytics_data["overall_total"] >= 1

    delete_attendance_resp = api_client.delete(
        f"{base_url}/api/admin/attendance/{record_id}",
        headers=admin_headers,
    )
    assert delete_attendance_resp.status_code == 200

    get_attendance_after_delete = api_client.get(
        f"{base_url}/api/admin/attendance?course_id={course_id}&student_id={student_id}",
        headers=admin_headers,
    )
    assert get_attendance_after_delete.status_code == 200
    assert all(item["record_id"] != record_id for item in get_attendance_after_delete.json())

    # basic token validity check for admin identity persistence
    me_resp = api_client.get(f"{base_url}/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"})
    assert me_resp.status_code == 200
    assert me_resp.json()["user_id"] == admin_user_id

    # reduce chance of immediate same-tag collisions in reruns
    time.sleep(0.1)
