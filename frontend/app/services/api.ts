import Constants from "expo-constants";

import {
  AttendanceRecord,
  AuthResponse,
  CollegeProfile,
  Course,
  NotificationItem,
  StudentInsightGroup,
  Subject,
  SubjectInsight,
  User,
} from "../types";

const expoConfigExtra = Constants.expoConfig?.extra as { backendUrl?: string } | undefined;
const backendBaseUrl =
  expoConfigExtra?.backendUrl?.replace(/\/$/, "") ||
  process.env.EXPO_BACKEND_URL?.replace(/\/$/, "") ||
  process.env.EXPO_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ||
  "";

async function request<T>(
  endpoint: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    token?: string;
    body?: Record<string, unknown>;
  } = {}
): Promise<T> {
  if (!backendBaseUrl) {
    throw new Error("Backend URL missing. Check EXPO_PUBLIC_BACKEND_URL.");
  }

  const response = await fetch(`${backendBaseUrl}/api${endpoint}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.detail || payload?.message || "Something went wrong.");
  }

  return payload as T;
}

export function signUp(data: {
  name: string;
  phone_number: string;
  password: string;
  role: "admin" | "student";
  course_id?: string | null;
}) {
  return request<AuthResponse>("/auth/signup", { method: "POST", body: data });
}

export function login(data: { phone_number: string; password: string }) {
  return request<AuthResponse>("/auth/login", { method: "POST", body: data });
}

export function forgotPasswordAdmin(data: { phone_number: string; new_password: string }) {
  return request<{ message: string }>("/auth/forgot-password-admin", { method: "POST", body: data });
}

export function getMe(token: string) {
  return request<User>("/auth/me", { token });
}

export function getCollegeProfile() {
  return request<CollegeProfile>("/college/profile");
}

export function getPendingStudents(token: string) {
  return request<User[]>("/admin/pending-students", { token });
}

export function approveStudent(token: string, studentId: string) {
  return request<{ message: string }>(`/admin/approve-student/${studentId}`, {
    method: "POST",
    token,
  });
}

export function getApprovedStudents(token: string) {
  return request<User[]>("/admin/students", { token });
}

export function createAdmin(token: string, payload: { name: string; phone_number: string; password: string }) {
  return request<User>("/admin/create-admin", {
    method: "POST",
    token,
    body: payload,
  });
}

export function updateCollegeProfile(
  token: string,
  payload: { college_name?: string; logo_base64?: string | null }
) {
  return request<CollegeProfile>("/admin/college-profile", {
    method: "PATCH",
    token,
    body: payload,
  });
}

export function createSemester(token: string, name: string) {
  return request<Course>("/admin/courses", {
    method: "POST",
    token,
    body: { name },
  });
}

export function getSemesters(token: string) {
  return request<Course[]>("/admin/courses", { token });
}

export function deleteCourse(token: string, courseId: string, admin_password: string) {
  return request<{ message: string }>(`/admin/courses/${courseId}`, {
    method: "DELETE",
    token,
    body: { admin_password },
  });
}

export function createSubject(token: string, payload: { course_id: string; name: string; code: string }) {
  return request<Subject>("/admin/subjects", {
    method: "POST",
    token,
    body: payload,
  });
}

export function getSubjects(token: string, semesterId?: string) {
  const query = semesterId ? `?course_id=${encodeURIComponent(semesterId)}` : "";
  return request<Subject[]>(`/admin/subjects${query}`, { token });
}

export function deleteSubject(token: string, subjectId: string, admin_password: string) {
  return request<{ message: string }>(`/admin/subjects/${subjectId}`, {
    method: "DELETE",
    token,
    body: { admin_password },
  });
}

export function assignSubjects(token: string, payload: { student_id: string; subject_ids: string[] }) {
  return request<{ message: string }>(`/admin/students/${payload.student_id}/assign-subjects`, {
    method: "POST",
    token,
    body: { subject_ids: payload.subject_ids },
  });
}

export function getSubjectStudents(token: string, subjectId: string) {
  return request<User[]>(`/admin/subject-students?subject_id=${encodeURIComponent(subjectId)}`, { token });
}

export function markBulkAttendance(
  token: string,
  payload: { subject_id: string; date: string; present_student_ids: string[] }
) {
  return request<{ message: string; updated_records: number }>("/admin/attendance/bulk", {
    method: "POST",
    token,
    body: payload,
  });
}

export function updateAttendance(token: string, recordId: string, status: "present" | "absent") {
  return request<{ message: string }>(`/admin/attendance/${recordId}`, {
    method: "PUT",
    token,
    body: { status },
  });
}

export function deleteAttendance(token: string, recordId: string, admin_password: string) {
  return request<{ message: string }>(`/admin/attendance/${recordId}`, {
    method: "DELETE",
    token,
    body: { admin_password },
  });
}

export function getAdminAttendance(token: string, filters?: { subject_id?: string; student_id?: string }) {
  const chunks: string[] = [];
  if (filters?.subject_id) chunks.push(`subject_id=${encodeURIComponent(filters.subject_id)}`);
  if (filters?.student_id) chunks.push(`student_id=${encodeURIComponent(filters.student_id)}`);
  const query = chunks.length ? `?${chunks.join("&")}` : "";
  return request<AttendanceRecord[]>(`/admin/attendance${query}`, { token });
}

export function getAdminInsights(token: string) {
  return request<{ insights: StudentInsightGroup[] }>("/admin/insights", { token });
}

export function getNotifications(token: string) {
  return request<NotificationItem[]>("/admin/notifications", { token });
}

export function markNotificationRead(token: string, notificationId: string) {
  return request<{ message: string }>(`/admin/notifications/${notificationId}/read`, {
    method: "POST",
    token,
  });
}

export function deleteStudent(token: string, studentId: string, admin_password: string) {
  return request<{ message: string }>(`/admin/students/${studentId}`, {
    method: "DELETE",
    token,
    body: { admin_password },
  });
}

export function adminUpdateStudentProfile(
  token: string,
  studentId: string,
  payload: { name?: string; course_id?: string | null; profile_image_base64?: string | null }
) {
  return request<{ message: string }>(`/admin/students/${studentId}/profile`, {
    method: "PATCH",
    token,
    body: payload,
  });
}

export function adminChangeStudentPassword(
  token: string,
  studentId: string,
  payload: { admin_password: string; new_password: string }
) {
  return request<{ message: string }>(`/admin/students/${studentId}/change-password`, {
    method: "POST",
    token,
    body: payload,
  });
}

export function resetAllData(token: string, admin_password: string) {
  return request<{ message: string; default_admin_phone: string; default_admin_password: string }>("/admin/reset-all", {
    method: "POST",
    token,
    body: { admin_password },
  });
}

export function getStudentSubjects(token: string) {
  return request<Subject[]>("/student/subjects", { token });
}

export function getStudentAttendance(token: string, subjectId?: string) {
  const query = subjectId ? `?subject_id=${encodeURIComponent(subjectId)}` : "";
  return request<AttendanceRecord[]>(`/student/attendance${query}`, { token });
}

export function getStudentInsights(token: string) {
  return request<SubjectInsight[]>("/student/insights", { token });
}

export function studentUpdateProfile(token: string, payload: { name?: string; course_id?: string | null; profile_image_base64?: string | null }) {
  return request<{ message: string }>("/student/profile", {
    method: "PATCH",
    token,
    body: payload,
  });
}

export function studentChangePassword(token: string, payload: { current_password: string; new_password: string }) {
  return request<{ message: string }>("/student/password", {
    method: "PATCH",
    token,
    body: payload,
  });
}

const routePlaceholder = { api: "internal" };
export default routePlaceholder;