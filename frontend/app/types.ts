export type UserRole = "admin" | "student";

export interface User {
  user_id: string;
  name: string;
  phone_number: string;
  role: UserRole;
  approved: boolean;
  course_id?: string | null;
  profile_image_base64?: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  message: string;
  user: User;
}

export interface Course {
  course_id: string;
  name: string;
  created_at: string;
}

export interface Subject {
  subject_id: string;
  course_id: string;
  name: string;
  code: string;
  created_at: string;
}

export interface AttendanceRecord {
  record_id: string;
  subject_id: string;
  subject_name: string;
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
  phone_number: string;
  created_at: string;
}

export interface SubjectInsight {
  subject_id: string;
  subject_name: string;
  present: number;
  total: number;
  percentage: number;
}

export interface StudentInsightGroup {
  course_id: string;
  course_name: string;
  student_id: string;
  student_name: string;
  profile_image_base64?: string;
  subjects: SubjectInsight[];
}

export interface NotificationItem {
  notification_id: string;
  message: string;
  event_type: string;
  student_id?: string;
  created_at: string;
  read: boolean;
}

export interface CollegeProfile {
  college_id: string;
  college_name: string;
  logo_base64?: string;
  updated_at: string;
}

const routePlaceholder = { types: "internal" };
export default routePlaceholder;