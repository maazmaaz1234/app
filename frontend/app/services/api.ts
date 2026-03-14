import Constants from "expo-constants";

import {
  AttendanceRecord,
  AuthResponse,
  CollegeProfile,
  Semester,
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
  return request<Semester>("/admin/semesters", {
    method: "POST",
    token,
    body: { name },
  });
}

export function getSemesters(token: string) {
  return request<Semester[]>("/admin/semesters", { token });
}

export function createSubject(token: string, payload: { semester_id: string; name: string; code: string }) {
  return request<Subject>("/admin/subjects", {
    method: "POST",
    token,
    body: payload,
  });
}

export function getSubjects(token: string, semesterId?: string) {
  const query = semesterId ? `?semester_id=${encodeURIComponent(semesterId)}` : "";
  return request<Subject[]>(`/admin/subjects${query}`, { token });
}

export function assignSubjects(token: string, payload: { student_id: string; subject_ids: string[] }) {
  return request<{ message: string }>("/admin/assign-subjects", {
    method: "POST",
    token,
    body: payload,
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

export function importCsv(token: string, csvText: string) {
  return request<{ message: string; students_created: number; students_updated: number; subjects_created: number }>(
    "/admin/import-csv",
    {
      method: "POST",
      token,
      body: { csv_text: csvText },
    }
  );
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

const routePlaceholder = { api: "internal" };
export default routePlaceholder;