import Constants from "expo-constants";

import {
  AnalyticsResponse,
  AttendanceRecord,
  AuthResponse,
  Course,
  PendingStudent,
  Semester,
  User,
} from "../types";

const expoConfigExtra = Constants.expoConfig?.extra as { backendUrl?: string } | undefined;
const backendBaseUrl =
  expoConfigExtra?.backendUrl?.replace(/\/$/, "") ||
  process.env.EXPO_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ||
  "";

async function request<T>(
  endpoint: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
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
  email: string;
  password: string;
  role: "college" | "student";
  college_name: string;
}) {
  return request<AuthResponse>("/auth/signup", { method: "POST", body: data });
}

export function login(data: { email: string; password: string }) {
  return request<AuthResponse>("/auth/login", { method: "POST", body: data });
}

export function getMe(token: string) {
  return request<User>("/auth/me", { token });
}

export function getPendingStudents(token: string) {
  return request<PendingStudent[]>("/admin/pending-students", { token });
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

export function createCourse(token: string, payload: { semester_id: string; name: string; code: string }) {
  return request<Course>("/admin/courses", {
    method: "POST",
    token,
    body: payload,
  });
}

export function getCourses(token: string, semesterId?: string) {
  const query = semesterId ? `?semester_id=${encodeURIComponent(semesterId)}` : "";
  return request<Course[]>(`/admin/courses${query}`, { token });
}

export function markAttendance(
  token: string,
  payload: { course_id: string; student_id: string; date: string; status: "present" | "absent" }
) {
  return request<AttendanceRecord>("/admin/attendance/mark", {
    method: "POST",
    token,
    body: payload,
  });
}

export function updateAttendance(token: string, recordId: string, status: "present" | "absent") {
  return request<AttendanceRecord>(`/admin/attendance/${recordId}`, {
    method: "PUT",
    token,
    body: { status },
  });
}

export function deleteAttendance(token: string, recordId: string) {
  return request<{ message: string }>(`/admin/attendance/${recordId}`, {
    method: "DELETE",
    token,
  });
}

export function getAdminAttendance(token: string, filters?: { course_id?: string; student_id?: string }) {
  const chunks: string[] = [];
  if (filters?.course_id) chunks.push(`course_id=${encodeURIComponent(filters.course_id)}`);
  if (filters?.student_id) chunks.push(`student_id=${encodeURIComponent(filters.student_id)}`);
  const query = chunks.length ? `?${chunks.join("&")}` : "";
  return request<AttendanceRecord[]>(`/admin/attendance${query}`, { token });
}

export function getAdminAnalytics(token: string, courseId?: string) {
  const query = courseId ? `?course_id=${encodeURIComponent(courseId)}` : "";
  return request<AnalyticsResponse>(`/admin/analytics${query}`, { token });
}

export function getStudentCourses(token: string) {
  return request<Course[]>("/student/courses", { token });
}

export function getStudentAttendance(token: string, courseId?: string) {
  const query = courseId ? `?course_id=${encodeURIComponent(courseId)}` : "";
  return request<AttendanceRecord[]>(`/student/attendance${query}`, { token });
}

export function getStudentAnalytics(token: string) {
  return request<AnalyticsResponse>("/student/analytics", { token });
}