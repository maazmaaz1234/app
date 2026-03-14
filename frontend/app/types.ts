export type UserRole = "college" | "student";

export interface User {
  user_id: string;
  name: string;
  email: string;
  role: UserRole;
  college_name: string;
  approved: boolean;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  message: string;
  user: User;
}

export interface Semester {
  semester_id: string;
  name: string;
  college_name: string;
  created_at: string;
}

export interface Course {
  course_id: string;
  semester_id: string;
  name: string;
  code: string;
  college_name: string;
  created_at: string;
}

export interface AttendanceRecord {
  record_id: string;
  course_id: string;
  course_name: string;
  student_id: string;
  student_name: string;
  date: string;
  status: "present" | "absent";
  marked_by: string;
  created_at: string;
  updated_at?: string | null;
}

export interface PendingStudent {
  user_id: string;
  name: string;
  email: string;
  college_name: string;
  created_at: string;
}

export interface AnalyticsCourse {
  course_id: string;
  course_name: string;
  present: number;
  total: number;
  percentage: number;
}

export interface AnalyticsResponse {
  overall_present: number;
  overall_total: number;
  overall_percentage: number;
  courses: AnalyticsCourse[];
}