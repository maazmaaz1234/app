import uuid


DEFAULT_ADMIN_PHONE = "+919999999999"
DEFAULT_ADMIN_PASSWORD = "admin123"


def _login(api_client, base_url, phone_number, password):
    return api_client.post(
        f"{base_url}/api/auth/login",
        json={"phone_number": phone_number, "password": password},
    )


def _ensure_default_admin_token(api_client, base_url):
    login_response = _login(api_client, base_url, DEFAULT_ADMIN_PHONE, DEFAULT_ADMIN_PASSWORD)
    if login_response.status_code != 200:
        reset_response = api_client.post(
            f"{base_url}/api/auth/forgot-password-admin",
            json={"phone_number": DEFAULT_ADMIN_PHONE, "new_password": DEFAULT_ADMIN_PASSWORD},
        )
        assert reset_response.status_code in (200, 404)
        login_response = _login(api_client, base_url, DEFAULT_ADMIN_PHONE, DEFAULT_ADMIN_PASSWORD)

    assert login_response.status_code == 200
    login_data = login_response.json()
    assert login_data["user"]["role"] == "admin"
    return login_data["access_token"]


# Auth + reset-all + course/subject/student CRUD + assignment + attendance + notifications + insights.
def test_course_subject_student_regression_flow(api_client, base_url):
    admin_token = _ensure_default_admin_token(api_client, base_url)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    reset_response = api_client.post(
        f"{base_url}/api/admin/reset-all",
        headers=admin_headers,
        json={"admin_password": DEFAULT_ADMIN_PASSWORD},
    )
    assert reset_response.status_code == 200
    reset_payload = reset_response.json()
    assert reset_payload["default_admin_phone"] == DEFAULT_ADMIN_PHONE
    assert reset_payload["default_admin_password"] == DEFAULT_ADMIN_PASSWORD

    login_after_reset = _login(api_client, base_url, DEFAULT_ADMIN_PHONE, DEFAULT_ADMIN_PASSWORD)
    assert login_after_reset.status_code == 200
    admin_token = login_after_reset.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    test_suffix = uuid.uuid4().hex[:8]
    student_phone = f"+9176{uuid.uuid4().int % 10**8:08d}"
    student_password = "studpass123"

    create_course = api_client.post(
        f"{base_url}/api/admin/courses",
        headers=admin_headers,
        json={"name": f"TEST_COURSE_{test_suffix}"},
    )
    assert create_course.status_code == 200
    course_id = create_course.json()["course_id"]

    courses_get = api_client.get(f"{base_url}/api/admin/courses", headers=admin_headers)
    assert courses_get.status_code == 200
    assert any(item["course_id"] == course_id for item in courses_get.json())

    create_subject = api_client.post(
        f"{base_url}/api/admin/subjects",
        headers=admin_headers,
        json={"course_id": course_id, "name": f"TEST_SUBJECT_{test_suffix}", "code": f"TS{test_suffix[:4].upper()}"},
    )
    assert create_subject.status_code == 200
    subject_id = create_subject.json()["subject_id"]

    subjects_get = api_client.get(f"{base_url}/api/admin/subjects?course_id={course_id}", headers=admin_headers)
    assert subjects_get.status_code == 200
    assert any(item["subject_id"] == subject_id and item["course_id"] == course_id for item in subjects_get.json())

    student_signup = api_client.post(
        f"{base_url}/api/auth/signup",
        json={
            "name": f"TEST_STUDENT_{test_suffix}",
            "phone_number": student_phone,
            "password": student_password,
            "role": "student",
            "course_id": course_id,
        },
    )
    assert student_signup.status_code == 200
    student_id = student_signup.json()["user"]["user_id"]
    assert student_signup.json()["user"]["approved"] is False

    approve_student = api_client.post(
        f"{base_url}/api/admin/approve-student/{student_id}",
        headers=admin_headers,
    )
    assert approve_student.status_code == 200

    approved_students = api_client.get(f"{base_url}/api/admin/students", headers=admin_headers)
    assert approved_students.status_code == 200
    assert any(item["user_id"] == student_id and item["approved"] is True for item in approved_students.json())

    assign_subjects = api_client.post(
        f"{base_url}/api/admin/students/{student_id}/assign-subjects",
        headers=admin_headers,
        json={"subject_ids": [subject_id]},
    )
    assert assign_subjects.status_code == 200

    attendance_date = "2026-01-20"
    bulk_attendance = api_client.post(
        f"{base_url}/api/admin/attendance/bulk",
        headers=admin_headers,
        json={"subject_id": subject_id, "date": attendance_date, "present_student_ids": [student_id]},
    )
    assert bulk_attendance.status_code == 200
    assert bulk_attendance.json()["updated_records"] >= 1

    admin_attendance = api_client.get(
        f"{base_url}/api/admin/attendance?subject_id={subject_id}&student_id={student_id}",
        headers=admin_headers,
    )
    assert admin_attendance.status_code == 200
    matching_records = [item for item in admin_attendance.json() if item["date"] == attendance_date]
    assert len(matching_records) == 1
    record_id = matching_records[0]["record_id"]

    update_attendance = api_client.put(
        f"{base_url}/api/admin/attendance/{record_id}",
        headers=admin_headers,
        json={"status": "absent"},
    )
    assert update_attendance.status_code == 200

    attendance_after_update = api_client.get(
        f"{base_url}/api/admin/attendance?subject_id={subject_id}&student_id={student_id}",
        headers=admin_headers,
    )
    assert attendance_after_update.status_code == 200
    updated_record = [item for item in attendance_after_update.json() if item["record_id"] == record_id][0]
    assert updated_record["status"] == "absent"

    wrong_password_delete_course = api_client.delete(
        f"{base_url}/api/admin/courses/{course_id}",
        headers=admin_headers,
        json={"admin_password": "wrong-pass"},
    )
    assert wrong_password_delete_course.status_code == 401

    admin_edit_student = api_client.patch(
        f"{base_url}/api/admin/students/{student_id}/profile",
        headers=admin_headers,
        json={"name": f"TEST_EDITED_{test_suffix}"},
    )
    assert admin_edit_student.status_code == 200

    admin_change_student_password = api_client.post(
        f"{base_url}/api/admin/students/{student_id}/change-password",
        headers=admin_headers,
        json={"admin_password": DEFAULT_ADMIN_PASSWORD, "new_password": "studpass999"},
    )
    assert admin_change_student_password.status_code == 200

    student_login = _login(api_client, base_url, student_phone, "studpass999")
    assert student_login.status_code == 200
    student_token = student_login.json()["access_token"]
    student_headers = {"Authorization": f"Bearer {student_token}"}

    student_update_profile = api_client.patch(
        f"{base_url}/api/student/profile",
        headers=student_headers,
        json={"name": f"TEST_STUDENT_PROFILE_{test_suffix}", "profile_image_base64": "data:image/png;base64,AAAA"},
    )
    assert student_update_profile.status_code == 200

    student_change_password = api_client.patch(
        f"{base_url}/api/student/password",
        headers=student_headers,
        json={"current_password": "studpass999", "new_password": "studpass777"},
    )
    assert student_change_password.status_code == 200

    notifications_get = api_client.get(f"{base_url}/api/admin/notifications", headers=admin_headers)
    assert notifications_get.status_code == 200
    notification_types = [item["event_type"] for item in notifications_get.json() if item.get("student_id") == student_id]
    assert "student_profile_updated" in notification_types
    assert "student_password_changed" in notification_types

    insights_get = api_client.get(f"{base_url}/api/admin/insights", headers=admin_headers)
    assert insights_get.status_code == 200
    matched_student_insights = [item for item in insights_get.json()["insights"] if item["student_id"] == student_id]
    assert len(matched_student_insights) == 1
    assert matched_student_insights[0]["course_id"] == course_id
    assert len(matched_student_insights[0]["subjects"]) >= 1

    delete_attendance = api_client.delete(
        f"{base_url}/api/admin/attendance/{record_id}",
        headers=admin_headers,
        json={"admin_password": DEFAULT_ADMIN_PASSWORD},
    )
    assert delete_attendance.status_code == 200

    attendance_after_delete = api_client.get(
        f"{base_url}/api/admin/attendance?subject_id={subject_id}&student_id={student_id}",
        headers=admin_headers,
    )
    assert attendance_after_delete.status_code == 200
    assert not any(item["record_id"] == record_id for item in attendance_after_delete.json())

    delete_student_response = api_client.delete(
        f"{base_url}/api/admin/students/{student_id}",
        headers=admin_headers,
        json={"admin_password": DEFAULT_ADMIN_PASSWORD},
    )
    assert delete_student_response.status_code == 200

    students_after_delete = api_client.get(f"{base_url}/api/admin/students", headers=admin_headers)
    assert students_after_delete.status_code == 200
    assert not any(item["user_id"] == student_id for item in students_after_delete.json())

    delete_subject_wrong_password = api_client.delete(
        f"{base_url}/api/admin/subjects/{subject_id}",
        headers=admin_headers,
        json={"admin_password": "wrong-pass"},
    )
    assert delete_subject_wrong_password.status_code == 401

    delete_subject_response = api_client.delete(
        f"{base_url}/api/admin/subjects/{subject_id}",
        headers=admin_headers,
        json={"admin_password": DEFAULT_ADMIN_PASSWORD},
    )
    assert delete_subject_response.status_code == 200

    subjects_after_delete = api_client.get(f"{base_url}/api/admin/subjects?course_id={course_id}", headers=admin_headers)
    assert subjects_after_delete.status_code == 200
    assert not any(item["subject_id"] == subject_id for item in subjects_after_delete.json())

    delete_course_response = api_client.delete(
        f"{base_url}/api/admin/courses/{course_id}",
        headers=admin_headers,
        json={"admin_password": DEFAULT_ADMIN_PASSWORD},
    )
    assert delete_course_response.status_code == 200

    courses_after_delete = api_client.get(f"{base_url}/api/admin/courses", headers=admin_headers)
    assert courses_after_delete.status_code == 200
    assert not any(item["course_id"] == course_id for item in courses_after_delete.json())
