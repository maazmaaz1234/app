import uuid


# Auth + approval + profile + semester/subject + assignment + attendance + CSV + insights coverage.
def test_phone_password_end_to_end_workflow(api_client, base_url):
    tag = f"TEST_{uuid.uuid4().hex[:8]}"
    admin_phone = f"+9199{uuid.uuid4().int % 10**8:08d}"
    student_phone = f"+9188{uuid.uuid4().int % 10**8:08d}"
    csv_phone = f"+9177{uuid.uuid4().int % 10**8:08d}"

    admin_password = "testpass123"
    admin_new_password = "testpass456"
    student_password = "studpass123"

    admin_signup = api_client.post(
        f"{base_url}/api/auth/signup",
        json={
            "name": "TEST Admin",
            "phone_number": admin_phone,
            "password": admin_password,
            "role": "admin",
        },
    )
    assert admin_signup.status_code == 200
    admin_signup_data = admin_signup.json()
    assert admin_signup_data["user"]["approved"] is True
    assert admin_signup_data["user"]["phone_number"] == admin_phone

    forgot_password = api_client.post(
        f"{base_url}/api/auth/forgot-password-admin",
        json={"phone_number": admin_phone, "new_password": admin_new_password},
    )
    assert forgot_password.status_code == 200
    assert forgot_password.json()["message"] == "Admin password reset successful"

    admin_login = api_client.post(
        f"{base_url}/api/auth/login",
        json={"phone_number": admin_phone, "password": admin_new_password},
    )
    assert admin_login.status_code == 200
    admin_login_data = admin_login.json()
    admin_token = admin_login_data["access_token"]
    assert admin_login_data["user"]["role"] == "admin"
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    student_signup = api_client.post(
        f"{base_url}/api/auth/signup",
        json={
            "name": "TEST Student",
            "phone_number": student_phone,
            "password": student_password,
            "role": "student",
        },
    )
    assert student_signup.status_code == 200
    student_signup_data = student_signup.json()
    student_id = student_signup_data["user"]["user_id"]
    assert student_signup_data["user"]["approved"] is False

    student_login_pre_approval = api_client.post(
        f"{base_url}/api/auth/login",
        json={"phone_number": student_phone, "password": student_password},
    )
    assert student_login_pre_approval.status_code == 200
    student_pending_token = student_login_pre_approval.json()["access_token"]

    student_pending_insights = api_client.get(
        f"{base_url}/api/student/insights",
        headers={"Authorization": f"Bearer {student_pending_token}"},
    )
    assert student_pending_insights.status_code == 403

    pending_students = api_client.get(f"{base_url}/api/admin/pending-students", headers=admin_headers)
    assert pending_students.status_code == 200
    assert any(item["user_id"] == student_id for item in pending_students.json())

    approve_student = api_client.post(
        f"{base_url}/api/admin/approve-student/{student_id}",
        headers=admin_headers,
    )
    assert approve_student.status_code == 200

    approved_students = api_client.get(f"{base_url}/api/admin/students", headers=admin_headers)
    assert approved_students.status_code == 200
    assert any(item["user_id"] == student_id and item["approved"] is True for item in approved_students.json())

    college_profile = api_client.get(f"{base_url}/api/college/profile")
    assert college_profile.status_code == 200
    assert college_profile.json()["college_name"]

    update_profile = api_client.patch(
        f"{base_url}/api/admin/college-profile",
        headers=admin_headers,
        json={"college_name": f"{tag} College"},
    )
    assert update_profile.status_code == 200
    assert update_profile.json()["college_name"] == f"{tag} College"

    profile_get_after_update = api_client.get(f"{base_url}/api/college/profile")
    assert profile_get_after_update.status_code == 200
    assert profile_get_after_update.json()["college_name"] == f"{tag} College"

    create_semester = api_client.post(
        f"{base_url}/api/admin/semesters",
        headers=admin_headers,
        json={"name": f"{tag} S1"},
    )
    assert create_semester.status_code == 200
    semester_id = create_semester.json()["semester_id"]

    get_semesters = api_client.get(f"{base_url}/api/admin/semesters", headers=admin_headers)
    assert get_semesters.status_code == 200
    assert any(item["semester_id"] == semester_id for item in get_semesters.json())

    create_subject = api_client.post(
        f"{base_url}/api/admin/subjects",
        headers=admin_headers,
        json={"semester_id": semester_id, "name": f"{tag} English", "code": f"{tag[:4]}E"},
    )
    assert create_subject.status_code == 200
    subject_id = create_subject.json()["subject_id"]

    get_subjects = api_client.get(f"{base_url}/api/admin/subjects", headers=admin_headers)
    assert get_subjects.status_code == 200
    assert any(item["subject_id"] == subject_id for item in get_subjects.json())

    assign_subjects_resp = api_client.post(
        f"{base_url}/api/admin/assign-subjects",
        headers=admin_headers,
        json={"student_id": student_id, "subject_ids": [subject_id]},
    )
    assert assign_subjects_resp.status_code == 200

    subject_students = api_client.get(
        f"{base_url}/api/admin/subject-students?subject_id={subject_id}",
        headers=admin_headers,
    )
    assert subject_students.status_code == 200
    assert any(item["user_id"] == student_id for item in subject_students.json())

    attendance_date = "2026-01-18"
    bulk_attendance = api_client.post(
        f"{base_url}/api/admin/attendance/bulk",
        headers=admin_headers,
        json={"subject_id": subject_id, "date": attendance_date, "present_student_ids": [student_id]},
    )
    assert bulk_attendance.status_code == 200
    assert bulk_attendance.json()["updated_records"] >= 1

    attendance_get = api_client.get(
        f"{base_url}/api/admin/attendance?subject_id={subject_id}&student_id={student_id}",
        headers=admin_headers,
    )
    assert attendance_get.status_code == 200
    matched = [item for item in attendance_get.json() if item["date"] == attendance_date]
    assert any(item["status"] == "present" for item in matched)

    csv_text = (
        "student_name,phone_number,password,semester,subjects\n"
        f"{tag} CSV Student,{csv_phone},csvpass123,{tag} S2,Maths|Physics"
    )
    csv_import_resp = api_client.post(
        f"{base_url}/api/admin/import-csv",
        headers=admin_headers,
        json={"csv_text": csv_text},
    )
    assert csv_import_resp.status_code == 200
    assert csv_import_resp.json()["message"] == "CSV imported"

    students_after_csv = api_client.get(f"{base_url}/api/admin/students", headers=admin_headers)
    assert students_after_csv.status_code == 200
    assert any(item["phone_number"] == csv_phone for item in students_after_csv.json())

    admin_insights = api_client.get(f"{base_url}/api/admin/insights", headers=admin_headers)
    assert admin_insights.status_code == 200
    insights_payload = admin_insights.json()
    assert isinstance(insights_payload["insights"], list)
    assert any(
        item["student_id"] == student_id and isinstance(item["subjects"], list)
        for item in insights_payload["insights"]
    )

    student_login_post_approval = api_client.post(
        f"{base_url}/api/auth/login",
        json={"phone_number": student_phone, "password": student_password},
    )
    assert student_login_post_approval.status_code == 200
    student_token = student_login_post_approval.json()["access_token"]
    student_headers = {"Authorization": f"Bearer {student_token}"}

    student_subjects = api_client.get(f"{base_url}/api/student/subjects", headers=student_headers)
    assert student_subjects.status_code == 200
    assert any(item["subject_id"] == subject_id for item in student_subjects.json())

    student_insights = api_client.get(f"{base_url}/api/student/insights", headers=student_headers)
    assert student_insights.status_code == 200
    assert any(item["subject_id"] == subject_id for item in student_insights.json())

    student_attendance = api_client.get(f"{base_url}/api/student/attendance", headers=student_headers)
    assert student_attendance.status_code == 200
    assert any(item["subject_id"] == subject_id and item["date"] == attendance_date for item in student_attendance.json())
