import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { GlassCard } from "./GlassCard";
import { PrimaryButton } from "./PrimaryButton";
import { TextField } from "./TextField";
import { theme } from "../constants/theme";
import {
  adminChangeStudentPassword,
  adminUpdateStudentProfile,
  approveStudent,
  assignSubjects,
  createAdmin,
  createSemester,
  createSubject,
  deleteAttendance,
  deleteCourse,
  deleteStudent,
  deleteSubject,
  forgotPasswordAdmin,
  getAdminAttendance,
  getAdminInsights,
  getApprovedStudents,
  getCollegeProfile,
  getMe,
  getNotifications,
  getPendingStudents,
  getSemesters,
  getStudentAttendance,
  getStudentInsights,
  getStudentSubjects,
  getSubjectStudents,
  getSubjects,
  login,
  markBulkAttendance,
  markNotificationRead,
  resetAllData,
  signUp,
  studentChangePassword,
  studentUpdateProfile,
  updateAttendance,
  updateCollegeProfile,
} from "../services/api";
import { AttendanceRecord, CollegeProfile, Course, NotificationItem, StudentInsightGroup, Subject, SubjectInsight, User } from "../types";

type Session = { token: string; user: User };
type AuthMode = "login" | "signup";
type AdminTab = "home" | "manage" | "insights" | "notifications" | "settings" | "developer";
type StudentTab = "home" | "history" | "insights" | "profile" | "settings" | "developer";

const SESSION_KEY = "svam_session";
const CALENDAR_VIEW_KEY = "svam_calendar_view";
const LOGO_ASSET = require("../../assets/images/shree-vedha-logo.png");

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function isValidPhone(value: string) {
  return /^\+?\d{10,15}$/.test(value.trim());
}

function isValidPassword(value: string) {
  return value.trim().length >= 6;
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function confirmAction(title: string, message: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: "Confirm", style: "destructive", onPress: onConfirm },
  ]);
}

async function pickBase64Image(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: true,
    quality: 0.6,
    base64: true,
    mediaTypes: ["images"],
  });
  if (result.canceled || !result.assets?.[0]?.base64) {
    return null;
  }
  return `data:image/jpeg;base64,${result.assets[0].base64}`;
}

export function MainApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<CollegeProfile | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  const loadProfile = useCallback(async () => {
    try {
      const profileData = await getCollegeProfile();
      setProfile(profileData);
    } catch {
      setProfile({
        college_id: "shree-vedha",
        college_name: "Shree Vedha College",
        logo_base64: "",
        updated_at: new Date().toISOString(),
      });
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await loadProfile();
      const stored = await AsyncStorage.getItem(SESSION_KEY);
      if (stored) {
        try {
          setSession(JSON.parse(stored) as Session);
        } catch {
          await AsyncStorage.removeItem(SESSION_KEY);
        }
      }
      setBootLoading(false);
    };
    init();
  }, [loadProfile]);

  const persistSession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    if (nextSession) {
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    } else {
      await AsyncStorage.removeItem(SESSION_KEY);
    }
  }, []);

  const doLogin = useCallback(
    async (phone_number: string, password: string) => {
      setAuthBusy(true);
      setAuthMessage("");
      try {
        const result = await login({ phone_number, password });
        await persistSession({ token: result.access_token, user: result.user });
      } catch (error) {
        setAuthMessage(error instanceof Error ? error.message : "Login failed");
      } finally {
        setAuthBusy(false);
      }
    },
    [persistSession]
  );

  const doSignup = useCallback(
    async (payload: { name: string; phone_number: string; password: string; role: "admin" | "student" }) => {
      setAuthBusy(true);
      setAuthMessage("");
      try {
        const result = await signUp(payload);
        await persistSession({ token: result.access_token, user: result.user });
      } catch (error) {
        setAuthMessage(error instanceof Error ? error.message : "Signup failed");
      } finally {
        setAuthBusy(false);
      }
    },
    [persistSession]
  );

  const doLogout = useCallback(async () => {
    await persistSession(null);
  }, [persistSession]);

  const refreshUser = useCallback(async () => {
    if (!session) return;
    try {
      const user = await getMe(session.token);
      await persistSession({ ...session, user });
    } catch {
      await doLogout();
    }
  }, [doLogout, persistSession, session]);

  if (bootLoading) {
    return (
      <SafeAreaView style={styles.loaderScreen}>
        <ActivityIndicator size="large" color={theme.primary} />
      </SafeAreaView>
    );
  }

  if (!session) {
    return <AuthScreen busy={authBusy} message={authMessage} onLogin={doLogin} onSignup={doSignup} />;
  }

  if (session.user.role === "student" && !session.user.approved) {
    return <PendingApproval onLogout={doLogout} onRefresh={refreshUser} />;
  }

  if (session.user.role === "admin") {
    return (
      <AdminApp
        token={session.token}
        user={session.user}
        profile={profile}
        onLogout={doLogout}
        onProfileUpdated={setProfile}
        onGlobalMessage={setAuthMessage}
        forceLogout={persistSession}
      />
    );
  }

  return (
    <StudentApp
      token={session.token}
      user={session.user}
      profile={profile}
      onLogout={doLogout}
      onProfileUpdated={setProfile}
      onSessionRefresh={refreshUser}
    />
  );
}

function AuthScreen({
  busy,
  message,
  onLogin,
  onSignup,
}: {
  busy: boolean;
  message: string;
  onLogin: (phone: string, password: string) => Promise<void>;
  onSignup: (payload: { name: string; phone_number: string; password: string; role: "admin" | "student" }) => Promise<void>;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [role, setRole] = useState<"admin" | "student">("student");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  const disableSubmit = useMemo(() => {
    const phoneOk = isValidPhone(phone);
    const passwordOk = isValidPassword(password);
    if (mode === "signup") {
      return !name.trim() || !phoneOk || !passwordOk;
    }
    return !phoneOk || !passwordOk;
  }, [mode, name, password, phone]);

  return (
    <SafeAreaView style={styles.safeRoot}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex1}>
        <ScrollView contentContainerStyle={styles.authContainer} keyboardShouldPersistTaps="handled">
          <Image source={LOGO_ASSET} style={styles.authLogo} resizeMode="contain" />
          <Text style={styles.authTitle}>Shree Vedha College Attendance Management</Text>

          <GlassCard style={styles.authCard}>
            <View style={styles.modeRow}>
              <Pressable testID="auth-login-mode" onPress={() => setMode("login")} style={[styles.modeBtn, mode === "login" && styles.modeBtnActive]}>
                <Text style={[styles.modeText, mode === "login" && styles.modeTextActive]}>Login</Text>
              </Pressable>
              <Pressable testID="auth-signup-mode" onPress={() => setMode("signup")} style={[styles.modeBtn, mode === "signup" && styles.modeBtnActive]}>
                <Text style={[styles.modeText, mode === "signup" && styles.modeTextActive]}>Sign Up</Text>
              </Pressable>
            </View>

            {mode === "signup" ? (
              <>
                <TextField label="Full Name" value={name} onChangeText={setName} placeholder="Enter full name" />
                <View style={styles.rowWrap}>
                  <RoleChip title="Student" active={role === "student"} onPress={() => setRole("student")} />
                  <RoleChip title="Admin" active={role === "admin"} onPress={() => setRole("admin")} />
                </View>
              </>
            ) : null}

            <TextField
              label="Phone Number"
              value={phone}
              onChangeText={setPhone}
              placeholder="+91XXXXXXXXXX"
              keyboardType="phone-pad"
            />
            {!isValidPhone(phone) && phone.trim() ? <ValidationHint text="Use valid phone format (+countrycode + number)" /> : null}
            <TextField label="Password" value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
            {!isValidPassword(password) && password.trim() ? <ValidationHint text="Password must be at least 6 characters" /> : null}

            {message ? <Text style={styles.messageText}>{message}</Text> : null}

            <PrimaryButton
              testID="auth-submit"
              title={mode === "login" ? "Login" : "Create Account"}
              icon="login"
              loading={busy}
              disabled={disableSubmit}
              onPress={() => {
                if (mode === "login") {
                  onLogin(phone.trim(), password.trim());
                } else {
                  onSignup({ name: name.trim(), phone_number: phone.trim(), password: password.trim(), role });
                }
              }}
            />
          </GlassCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PendingApproval({ onLogout, onRefresh }: { onLogout: () => Promise<void>; onRefresh: () => Promise<void> }) {
  return (
    <SafeAreaView style={styles.safeRoot}>
      <View style={styles.centerWrap}>
        <GlassCard style={styles.pendingCard}>
          <Image source={LOGO_ASSET} style={styles.pendingLogo} resizeMode="contain" />
          <Text style={styles.sectionTitle}>Approval Pending</Text>
          <Text style={styles.smallText}>Your account will open once admin approves.</Text>
          <PrimaryButton title="Check Approval" icon="refresh" onPress={onRefresh} />
          <PrimaryButton title="Logout" icon="logout" variant="secondary" onPress={() => onLogout()} />
        </GlassCard>
      </View>
    </SafeAreaView>
  );
}

function AdminApp({
  token,
  user,
  profile,
  onLogout,
  onProfileUpdated,
  onGlobalMessage,
  forceLogout,
}: {
  token: string;
  user: User;
  profile: CollegeProfile | null;
  onLogout: () => Promise<void>;
  onProfileUpdated: (profile: CollegeProfile) => void;
  onGlobalMessage: (value: string) => void;
  forceLogout: (next: Session | null) => Promise<void>;
}) {
  const [tab, setTab] = useState<AdminTab>("home");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const [courses, setCourses] = useState<Course[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [students, setStudents] = useState<User[]>([]);
  const [pendingStudents, setPendingStudents] = useState<User[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [insights, setInsights] = useState<StudentInsightGroup[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [calendarView, setCalendarView] = useState<"grid" | "list">("grid");
  const [calendarMonth, setCalendarMonth] = useState(today().slice(0, 7));

  const [courseName, setCourseName] = useState("");
  const [subjectCourse, setSubjectCourse] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [subjectCode, setSubjectCode] = useState("");
  const [selectedStudent, setSelectedStudent] = useState("");
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [bulkSubject, setBulkSubject] = useState("");
  const [bulkDate, setBulkDate] = useState(today());
  const [bulkStudents, setBulkStudents] = useState<User[]>([]);
  const [presentStudentIds, setPresentStudentIds] = useState<string[]>([]);
  const [selectedAttendanceRecord, setSelectedAttendanceRecord] = useState<string>("");

  const [selectedStudentName, setSelectedStudentName] = useState("");
  const [selectedStudentCourse, setSelectedStudentCourse] = useState<string | null>(null);
  const [selectedStudentImage, setSelectedStudentImage] = useState<string | null>(null);
  const [studentNewPassword, setStudentNewPassword] = useState("");
  const [adminPasswordAction, setAdminPasswordAction] = useState("");

  const [collegeName, setCollegeName] = useState(profile?.college_name || "Shree Vedha College");
  const [adminName, setAdminName] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [selfResetPhone, setSelfResetPhone] = useState(user.phone_number);
  const [selfResetPassword, setSelfResetPassword] = useState("");
  const [resetAllPassword, setResetAllPassword] = useState("");

  const refreshAll = useCallback(async () => {
    setBusy(true);
    try {
      const [courseData, subjectData, approved, pending, attendanceData, insightData, noticeData, profileData] = await Promise.all([
        getSemesters(token),
        getSubjects(token),
        getApprovedStudents(token),
        getPendingStudents(token),
        getAdminAttendance(token),
        getAdminInsights(token),
        getNotifications(token),
        getCollegeProfile(),
      ]);

      setCourses(courseData);
      setSubjects(subjectData);
      setStudents(approved);
      setPendingStudents(pending);
      setAttendance(attendanceData);
      setInsights(insightData.insights);
      setNotifications(noticeData);
      setCollegeName(profileData.college_name);
      onProfileUpdated(profileData);

      if (!subjectCourse && courseData[0]?.course_id) setSubjectCourse(courseData[0].course_id);
      if (!selectedStudent && approved[0]?.user_id) setSelectedStudent(approved[0].user_id);
      if (!bulkSubject && subjectData[0]?.subject_id) setBulkSubject(subjectData[0].subject_id);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load admin data");
    } finally {
      setBusy(false);
    }
  }, [bulkSubject, onProfileUpdated, selectedStudent, subjectCourse, token]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const current = students.find((item) => item.user_id === selectedStudent);
    if (current) {
      setSelectedStudentName(current.name);
      setSelectedStudentCourse(current.course_id || null);
      setSelectedStudentImage(current.profile_image_base64 || null);
    }
  }, [selectedStudent, students]);

  useEffect(() => {
    const loadCalendarPreference = async () => {
      const stored = await AsyncStorage.getItem(CALENDAR_VIEW_KEY);
      if (stored === "grid" || stored === "list") {
        setCalendarView(stored);
      }
    };
    loadCalendarPreference();
  }, []);

  useEffect(() => {
    const loadBulkStudents = async () => {
      if (!bulkSubject) return;
      try {
        const data = await getSubjectStudents(token, bulkSubject);
        setBulkStudents(data);
        setPresentStudentIds([]);
      } catch {
        setBulkStudents([]);
      }
    };
    loadBulkStudents();
  }, [bulkSubject, token]);

  const logoSource = profile?.logo_base64 ? { uri: profile.logo_base64 } : LOGO_ASSET;

  const tabs: { key: AdminTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "manage", label: "Manage", icon: "create-outline" },
    { key: "insights", label: "Insights", icon: "stats-chart-outline" },
    { key: "notifications", label: "Alerts", icon: "notifications-outline" },
    { key: "settings", label: "Settings", icon: "settings-outline" },
    { key: "developer", label: "Dev", icon: "code-slash-outline" },
  ];

  const atRiskStudents = useMemo(
    () =>
      insights.filter((student) => student.subjects.some((subject) => subject.percentage < 75)).map((student) => ({
        name: student.student_name,
        course: student.course_name,
        riskySubjects: student.subjects.filter((subject) => subject.percentage < 75),
      })),
    [insights]
  );

  return (
    <SafeAreaView style={styles.safeRoot}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerTitle}>{profile?.college_name || "Shree Vedha College"}</Text>
          <Text style={styles.headerSubtitle}>Admin: {user.name}</Text>
        </View>
        <Pressable style={styles.refreshBtn} onPress={refreshAll}>
          <Ionicons name="refresh" size={20} color={theme.text} />
        </Pressable>
      </View>

      {message ? <Text style={styles.messageText}>{message}</Text> : null}
      {busy ? <Text style={styles.messageText}>Updating...</Text> : null}

      <View style={styles.flex1}>
        {tab === "home" ? (
          <ScrollView contentContainerStyle={styles.screenBody}>
            <GlassCard>
              <View style={styles.logoTitleRow}>
                <Image source={logoSource} style={styles.heroLogo} resizeMode="contain" />
                <View style={styles.flex1}>
                  <Text style={styles.sectionTitle}>{profile?.college_name || "Shree Vedha College"}</Text>
                  <Text style={styles.smallText}>Professional Attendance Dashboard</Text>
                </View>
              </View>
            </GlassCard>
            <View style={styles.statGrid}>
              <StatCard label="Courses" value={`${courses.length}`} />
              <StatCard label="Subjects" value={`${subjects.length}`} />
              <StatCard label="Students" value={`${students.length}`} />
              <StatCard label="Pending" value={`${pendingStudents.length}`} />
            </View>

            <GlassCard>
              <Text style={styles.sectionTitle}>At Risk Students (&lt;75%)</Text>
              {!atRiskStudents.length ? <Text style={styles.smallText}>No at-risk students right now.</Text> : null}
              <View style={styles.listWrap}>
                {atRiskStudents.map((item, index) => (
                  <View key={`${item.name}-${index}`} style={styles.riskCard}>
                    <Text style={styles.rowTitle}>{item.name}</Text>
                    <Text style={styles.smallText}>{item.course}</Text>
                    <Text style={styles.riskText}>
                      {item.riskySubjects.map((subject) => `${subject.subject_name.split(" (Total")[0]} ${subject.percentage.toFixed(1)}%`).join(" • ")}
                    </Text>
                  </View>
                ))}
              </View>
            </GlassCard>

            <GlassCard>
              <Text style={styles.sectionTitle}>Pending Approvals</Text>
              {!pendingStudents.length ? <Text style={styles.smallText}>No pending requests.</Text> : null}
              <View style={styles.listWrap}>
                {pendingStudents.map((student) => (
                  <View key={student.user_id} style={styles.rowCard}>
                    <View>
                      <Text style={styles.rowTitle}>{student.name}</Text>
                      <Text style={styles.smallText}>{student.phone_number}</Text>
                    </View>
                    <PrimaryButton
                      title="Approve"
                      icon="check"
                      onPress={async () => {
                        setBusy(true);
                        try {
                          await approveStudent(token, student.user_id);
                          await refreshAll();
                          setMessage("Student approved");
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : "Approval failed");
                          setBusy(false);
                        }
                      }}
                    />
                  </View>
                ))}
              </View>
            </GlassCard>
          </ScrollView>
        ) : null}

        {tab === "manage" ? (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex1}>
            <ScrollView contentContainerStyle={styles.screenBody} keyboardShouldPersistTaps="handled">
              <GlassCard>
                <Text style={styles.sectionTitle}>Course Management</Text>
                <TextField label="Course Name" value={courseName} onChangeText={setCourseName} placeholder="BCA" />
                <PrimaryButton
                  title="Add Course"
                  icon="plus"
                  disabled={!courseName.trim()}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await createSemester(token, courseName.trim());
                      setCourseName("");
                      await refreshAll();
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Course create failed");
                      setBusy(false);
                    }
                  }}
                />
                <Text style={styles.smallText}>Delete course (requires admin password)</Text>
                <View style={styles.listWrap}>
                  {courses.map((course) => (
                    <View key={course.course_id} style={styles.rowCard}>
                      <Text style={styles.rowTitle}>{course.name}</Text>
                      <PrimaryButton
                        title="Delete"
                        icon="delete"
                        variant="danger"
                        onPress={() =>
                          confirmAction("Delete Course", `Delete ${course.name}?`, async () => {
                            if (!adminPasswordAction.trim()) {
                              setMessage("Enter admin password first");
                              return;
                            }
                            setBusy(true);
                            try {
                              await deleteCourse(token, course.course_id, adminPasswordAction.trim());
                              await refreshAll();
                            } catch (error) {
                              setMessage(error instanceof Error ? error.message : "Delete failed");
                              setBusy(false);
                            }
                          })
                        }
                      />
                    </View>
                  ))}
                </View>
              </GlassCard>

              <GlassCard>
                <Text style={styles.sectionTitle}>Subject Management</Text>
                <Text style={styles.smallText}>Select course</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowWrap}>
                  {courses.map((course) => (
                    <Chip
                      key={course.course_id}
                      title={course.name}
                      active={subjectCourse === course.course_id}
                      onPress={() => setSubjectCourse(course.course_id)}
                    />
                  ))}
                </ScrollView>
                <TextField label="Subject Name" value={subjectName} onChangeText={setSubjectName} placeholder="English" />
                <TextField label="Subject Code" value={subjectCode} onChangeText={setSubjectCode} placeholder="ENG01" />
                <PrimaryButton
                  title="Add Subject"
                  icon="book-plus"
                  disabled={!subjectCourse || !subjectName.trim() || !subjectCode.trim()}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await createSubject(token, { course_id: subjectCourse, name: subjectName.trim(), code: subjectCode.trim() });
                      setSubjectName("");
                      setSubjectCode("");
                      await refreshAll();
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Subject create failed");
                      setBusy(false);
                    }
                  }}
                />

                <View style={styles.listWrap}>
                  {subjects.map((subject) => (
                    <View key={subject.subject_id} style={styles.rowCard}>
                      <Text style={styles.rowTitle}>{subject.name}</Text>
                      <PrimaryButton
                        title="Delete"
                        icon="delete"
                        variant="danger"
                        onPress={() =>
                          confirmAction("Delete Subject", `Delete ${subject.name}?`, async () => {
                            if (!adminPasswordAction.trim()) {
                              setMessage("Enter admin password first");
                              return;
                            }
                            setBusy(true);
                            try {
                              await deleteSubject(token, subject.subject_id, adminPasswordAction.trim());
                              await refreshAll();
                            } catch (error) {
                              setMessage(error instanceof Error ? error.message : "Subject delete failed");
                              setBusy(false);
                            }
                          })
                        }
                      />
                    </View>
                  ))}
                </View>
              </GlassCard>

              <GlassCard>
                <Text style={styles.sectionTitle}>Student Management</Text>
                <Text style={styles.smallText}>Select student</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowWrap}>
                  {students.map((student) => (
                    <Chip
                      key={student.user_id}
                      title={student.name}
                      active={selectedStudent === student.user_id}
                      onPress={() => setSelectedStudent(student.user_id)}
                    />
                  ))}
                </ScrollView>

                <TextField label="Student Name" value={selectedStudentName} onChangeText={setSelectedStudentName} placeholder="Student name" />

                <Text style={styles.smallText}>Course</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowWrap}>
                  {courses.map((course) => (
                    <Chip
                      key={course.course_id}
                      title={course.name}
                      active={selectedStudentCourse === course.course_id}
                      onPress={() => setSelectedStudentCourse(course.course_id)}
                    />
                  ))}
                </ScrollView>

                <PrimaryButton
                  title="Upload Student Photo"
                  icon="image"
                  variant="secondary"
                  onPress={async () => {
                    const image = await pickBase64Image();
                    if (image) setSelectedStudentImage(image);
                  }}
                />

                <PrimaryButton
                  title="Save Student Profile"
                  icon="content-save"
                  disabled={!selectedStudent}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await adminUpdateStudentProfile(token, selectedStudent, {
                        name: selectedStudentName.trim(),
                        course_id: selectedStudentCourse,
                        profile_image_base64: selectedStudentImage,
                      });
                      await refreshAll();
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Student update failed");
                      setBusy(false);
                    }
                  }}
                />

                <TextField
                  label="New Student Password"
                  value={studentNewPassword}
                  onChangeText={setStudentNewPassword}
                  placeholder="New password"
                  secureTextEntry
                />
                <TextField
                  label="Admin Password (required for delete/password change)"
                  value={adminPasswordAction}
                  onChangeText={setAdminPasswordAction}
                  placeholder="Admin password"
                  testID="admin-password-action"
                  secureTextEntry
                />
                {!isValidPassword(adminPasswordAction) && adminPasswordAction.trim() ? (
                  <ValidationHint text="Admin password must be at least 6 characters" />
                ) : null}

                <PrimaryButton
                  title="Change Student Password"
                  icon="lock-reset"
                  disabled={!selectedStudent || !studentNewPassword.trim() || !adminPasswordAction.trim()}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await adminChangeStudentPassword(token, selectedStudent, {
                        admin_password: adminPasswordAction.trim(),
                        new_password: studentNewPassword.trim(),
                      });
                      setStudentNewPassword("");
                      setMessage("Student password changed");
                      setBusy(false);
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Password change failed");
                      setBusy(false);
                    }
                  }}
                />

                <PrimaryButton
                  title="Delete Student"
                  icon="account-remove"
                  variant="danger"
                  disabled={!selectedStudent || !adminPasswordAction.trim()}
                  onPress={() =>
                    confirmAction("Delete Student", "This will remove student and records. Continue?", async () => {
                      setBusy(true);
                      try {
                        await deleteStudent(token, selectedStudent, adminPasswordAction.trim());
                        setSelectedStudent("");
                        await refreshAll();
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "Student delete failed");
                        setBusy(false);
                      }
                    })
                  }
                />
              </GlassCard>

              <GlassCard>
                <Text style={styles.sectionTitle}>Assign Subjects</Text>
                <Text style={styles.smallText}>Select one or more subjects for selected student</Text>
                <View style={styles.wrapContainer}>
                  {subjects.map((subject) => (
                    <Chip
                      key={subject.subject_id}
                      title={subject.code}
                      active={selectedSubjectIds.includes(subject.subject_id)}
                      onPress={() => {
                        setSelectedSubjectIds((prev) =>
                          prev.includes(subject.subject_id) ? prev.filter((id) => id !== subject.subject_id) : [...prev, subject.subject_id]
                        );
                      }}
                    />
                  ))}
                </View>
                <PrimaryButton
                  title="Assign"
                  icon="account-check"
                  disabled={!selectedStudent || !selectedSubjectIds.length}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await assignSubjects(token, { student_id: selectedStudent, subject_ids: selectedSubjectIds });
                      setSelectedSubjectIds([]);
                      await refreshAll();
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Assignment failed");
                      setBusy(false);
                    }
                  }}
                />
              </GlassCard>

              <GlassCard>
                <Text style={styles.sectionTitle}>Bulk Attendance</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowWrap}>
                  {subjects.map((subject) => (
                    <Chip
                      key={subject.subject_id}
                      title={subject.name}
                      active={bulkSubject === subject.subject_id}
                      onPress={() => setBulkSubject(subject.subject_id)}
                    />
                  ))}
                </ScrollView>
                <TextField label="Date" value={bulkDate} onChangeText={setBulkDate} placeholder="YYYY-MM-DD" />
                {!isValidDate(bulkDate) && bulkDate.trim() ? <ValidationHint text="Date must be YYYY-MM-DD" /> : null}
                <Text style={styles.smallText}>Select present students, rest will be absent.</Text>
                <View style={styles.listWrap}>
                  {bulkStudents.map((student) => {
                    const active = presentStudentIds.includes(student.user_id);
                    return (
                      <Pressable
                        testID={`bulk-select-${student.user_id}`}
                        key={student.user_id}
                        style={[styles.selectRow, active && styles.selectRowActive]}
                        onPress={() => {
                        setPresentStudentIds((prev) =>
                          prev.includes(student.user_id) ? prev.filter((id) => id !== student.user_id) : [...prev, student.user_id]
                        );
                        }}>
                        <Text style={styles.rowTitle}>{student.name}</Text>
                        <MaterialCommunityIcons
                          name={active ? "check-circle" : "circle-outline"}
                          size={24}
                          color={active ? theme.success : theme.mutedText}
                        />
                      </Pressable>
                    );
                  })}
                </View>
                <PrimaryButton
                  title="Save Bulk Attendance"
                  icon="content-save"
                  disabled={!bulkSubject || !isValidDate(bulkDate)}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await markBulkAttendance(token, {
                        subject_id: bulkSubject,
                        date: bulkDate.trim(),
                        present_student_ids: presentStudentIds,
                      });
                      await refreshAll();
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Bulk attendance failed");
                      setBusy(false);
                    }
                  }}
                />
              </GlassCard>

              <GlassCard>
                <Text style={styles.sectionTitle}>Change Added Attendance</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowWrap}>
                  {attendance.slice(0, 20).map((record) => (
                    <Chip
                      key={record.record_id}
                      title={`${record.student_name}-${record.subject_name}`}
                      active={selectedAttendanceRecord === record.record_id}
                      onPress={() => setSelectedAttendanceRecord(record.record_id)}
                    />
                  ))}
                </ScrollView>

                <View style={styles.rowWrap}>
                  <PrimaryButton
                    title="Mark Present"
                    icon="check"
                    disabled={!selectedAttendanceRecord}
                    onPress={async () => {
                      try {
                        await updateAttendance(token, selectedAttendanceRecord, "present");
                        await refreshAll();
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "Update failed");
                      }
                    }}
                  />
                  <PrimaryButton
                    title="Mark Absent"
                    icon="close"
                    variant="secondary"
                    disabled={!selectedAttendanceRecord}
                    onPress={async () => {
                      try {
                        await updateAttendance(token, selectedAttendanceRecord, "absent");
                        await refreshAll();
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "Update failed");
                      }
                    }}
                  />
                </View>

                <PrimaryButton
                  title="Delete Attendance"
                  icon="delete"
                  variant="danger"
                  disabled={!selectedAttendanceRecord || !adminPasswordAction.trim()}
                  onPress={() =>
                    confirmAction("Delete Attendance", "Delete selected attendance record?", async () => {
                      try {
                        await deleteAttendance(token, selectedAttendanceRecord, adminPasswordAction.trim());
                        setSelectedAttendanceRecord("");
                        await refreshAll();
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "Delete failed");
                      }
                    })
                  }
                />
              </GlassCard>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : null}

        {tab === "insights" ? (
          <ScrollView contentContainerStyle={styles.screenBody}>
            <GlassCard>
              <Text style={styles.sectionTitle}>Insights: Course → Student → Subjects</Text>
              <View style={styles.rowWrap}>
                <Chip
                  title="Grid"
                  active={calendarView === "grid"}
                  onPress={async () => {
                    setCalendarView("grid");
                    await AsyncStorage.setItem(CALENDAR_VIEW_KEY, "grid");
                  }}
                />
                <Chip
                  title="List"
                  active={calendarView === "list"}
                  onPress={async () => {
                    setCalendarView("list");
                    await AsyncStorage.setItem(CALENDAR_VIEW_KEY, "list");
                  }}
                />
              </View>
              <TextField label="Month (YYYY-MM)" value={calendarMonth} onChangeText={setCalendarMonth} placeholder="2026-03" />
              {!insights.length ? <Text style={styles.smallText}>No insight data yet.</Text> : null}
              {insights.map((item) => (
                <GlassCard key={`${item.course_id}-${item.student_id}`} style={styles.innerCard}>
                  <Text style={styles.rowTitle}>{item.course_name}</Text>
                  <View style={styles.logoTitleRow}>
                    <Image source={item.profile_image_base64 ? { uri: item.profile_image_base64 } : LOGO_ASSET} style={styles.avatar} />
                    <Text style={styles.smallText}>{item.student_name}</Text>
                  </View>
                  {item.subjects.map((subject) => {
                    const calendar = attendance.filter((a) => a.student_id === item.student_id && a.subject_id === subject.subject_id);
                    const monthCalendar = calendar.filter((entry) => entry.date.startsWith(calendarMonth));
                    return (
                      <View key={subject.subject_id} style={styles.insightCard}>
                        <Text style={styles.smallText}>{subject.subject_name}</Text>
                        <Text style={styles.percentText}>{subject.percentage.toFixed(1)}%</Text>
                        {calendarView === "list" ? (
                          <Text style={styles.calendarText}>
                            Calendar: {monthCalendar.map((e) => `${formatDate(e.date)}-${e.status[0].toUpperCase()}`).join(", ") || "No entries"}
                          </Text>
                        ) : (
                          <MonthGrid month={calendarMonth} entries={monthCalendar} />
                        )}
                      </View>
                    );
                  })}
                </GlassCard>
              ))}
            </GlassCard>
          </ScrollView>
        ) : null}

        {tab === "notifications" ? (
          <ScrollView contentContainerStyle={styles.screenBody}>
            <GlassCard>
              <Text style={styles.sectionTitle}>Notification Center</Text>
              {!notifications.length ? <Text style={styles.smallText}>No notifications yet.</Text> : null}
              <View style={styles.listWrap}>
                {notifications.map((item) => (
                  <View key={item.notification_id} style={[styles.noticeCard, item.read && styles.noticeRead]}>
                    <View style={styles.flex1}>
                      <Text style={styles.rowTitle}>{item.message}</Text>
                      <Text style={styles.smallText}>{formatDate(item.created_at)}</Text>
                    </View>
                    {!item.read ? (
                      <PrimaryButton
                        title="Read"
                        icon="check"
                        variant="secondary"
                        onPress={async () => {
                          await markNotificationRead(token, item.notification_id);
                          await refreshAll();
                        }}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
            </GlassCard>
          </ScrollView>
        ) : null}

        {tab === "settings" ? (
          <ScrollView contentContainerStyle={styles.screenBody}>
            <GlassCard>
              <Text style={styles.sectionTitle}>Brand & Admin</Text>
              <TextField label="College Name" value={collegeName} onChangeText={setCollegeName} placeholder="College name" />
              <PrimaryButton
                title="Update College Name"
                icon="pencil"
                onPress={async () => {
                  try {
                    const updated = await updateCollegeProfile(token, { college_name: collegeName.trim() });
                    onProfileUpdated(updated);
                    setMessage("College name updated");
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Update failed");
                  }
                }}
              />
            </GlassCard>

            <GlassCard>
              <Text style={styles.sectionTitle}>Create Admin</Text>
              <TextField label="Admin Name" value={adminName} onChangeText={setAdminName} placeholder="Name" />
              <TextField label="Admin Phone" value={adminPhone} onChangeText={setAdminPhone} placeholder="+91XXXXXXXXXX" />
              <TextField label="Password" value={adminPassword} onChangeText={setAdminPassword} placeholder="Password" secureTextEntry />
              <PrimaryButton
                title="Create Admin"
                icon="account-plus"
                disabled={!adminName.trim() || !adminPhone.trim() || !adminPassword.trim()}
                onPress={async () => {
                  try {
                    await createAdmin(token, {
                      name: adminName.trim(),
                      phone_number: adminPhone.trim(),
                      password: adminPassword.trim(),
                    });
                    setAdminName("");
                    setAdminPhone("");
                    setAdminPassword("");
                    setMessage("Admin created");
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Create admin failed");
                  }
                }}
              />
            </GlassCard>

            <GlassCard>
              <Text style={styles.sectionTitle}>Hidden Password Reset</Text>
              <TextField label="Admin Phone" value={selfResetPhone} onChangeText={setSelfResetPhone} placeholder="+91XXXXXXXXXX" />
              <TextField
                label="New Password"
                value={selfResetPassword}
                onChangeText={setSelfResetPassword}
                placeholder="New password"
                secureTextEntry
              />
              <PrimaryButton
                title="Reset Admin Password"
                icon="key-change"
                disabled={!selfResetPhone.trim() || !selfResetPassword.trim()}
                onPress={async () => {
                  try {
                    await forgotPasswordAdmin({ phone_number: selfResetPhone.trim(), new_password: selfResetPassword.trim() });
                    setSelfResetPassword("");
                    setMessage("Admin password reset");
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Reset failed");
                  }
                }}
              />
            </GlassCard>

            <GlassCard>
              <Text style={styles.sectionTitle}>Fresh Start (Reset All Data)</Text>
              <Text style={styles.smallText}>This clears all admins, students, attendance, subjects and courses.</Text>
              <TextField
                label="Current Admin Password"
                value={resetAllPassword}
                onChangeText={setResetAllPassword}
                placeholder="Required"
                secureTextEntry
              />
              <PrimaryButton
                title="Reset All Data"
                icon="delete-forever"
                variant="danger"
                disabled={!resetAllPassword.trim()}
                onPress={() =>
                  confirmAction("Reset All Data", "This will wipe entire app data. Continue?", async () => {
                    try {
                      const result = await resetAllData(token, resetAllPassword.trim());
                      await forceLogout(null);
                      onGlobalMessage(
                        `Fresh reset done. Login with ${result.default_admin_phone} / ${result.default_admin_password}`
                      );
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Reset failed");
                    }
                  })
                }
              />
            </GlassCard>

            <GlassCard>
              <PrimaryButton title="Open Developer" icon="account" variant="secondary" onPress={() => setTab("developer")} />
            </GlassCard>

            <GlassCard>
              <PrimaryButton title="Logout" icon="logout" variant="danger" onPress={() => onLogout()} />
            </GlassCard>
          </ScrollView>
        ) : null}

        {tab === "developer" ? <DeveloperCard /> : null}
      </View>

      <BottomTabs items={tabs} activeKey={tab} onPress={(next) => setTab(next as AdminTab)} />
    </SafeAreaView>
  );
}

function StudentApp({
  token,
  user,
  profile,
  onLogout,
  onProfileUpdated,
  onSessionRefresh,
}: {
  token: string;
  user: User;
  profile: CollegeProfile | null;
  onLogout: () => Promise<void>;
  onProfileUpdated: (profile: CollegeProfile) => void;
  onSessionRefresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<StudentTab>("home");
  const [message, setMessage] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [insights, setInsights] = useState<SubjectInsight[]>([]);
  const [subjectFilter, setSubjectFilter] = useState("");
  const [profileName, setProfileName] = useState(user.name);
  const [profileImage, setProfileImage] = useState<string | null>(user.profile_image_base64 || null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const refreshAll = useCallback(async () => {
    try {
      const [subjectData, attendanceData, insightData, profileData] = await Promise.all([
        getStudentSubjects(token),
        getStudentAttendance(token),
        getStudentInsights(token),
        getCollegeProfile(),
      ]);
      setSubjects(subjectData);
      setAttendance(attendanceData);
      setInsights(insightData);
      onProfileUpdated(profileData);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    }
  }, [onProfileUpdated, token]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const logoSource = profile?.logo_base64 ? { uri: profile.logo_base64 } : LOGO_ASSET;
  const tabs: { key: StudentTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "history", label: "History", icon: "calendar-outline" },
    { key: "insights", label: "Insights", icon: "stats-chart-outline" },
    { key: "profile", label: "Profile", icon: "person-outline" },
    { key: "settings", label: "Settings", icon: "settings-outline" },
    { key: "developer", label: "Dev", icon: "code-slash-outline" },
  ];

  const filteredAttendance = attendance.filter((item) => (subjectFilter ? item.subject_id === subjectFilter : true));
  const atRiskSubjects = useMemo(() => insights.filter((item) => item.percentage < 75), [insights]);

  return (
    <SafeAreaView style={styles.safeRoot}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerTitle}>{profile?.college_name || "Shree Vedha College"}</Text>
          <Text style={styles.headerSubtitle}>{user.name}</Text>
        </View>
        <Pressable style={styles.refreshBtn} onPress={refreshAll}>
          <Ionicons name="refresh" size={20} color={theme.text} />
        </Pressable>
      </View>
      {message ? <Text style={styles.messageText}>{message}</Text> : null}

      <View style={styles.flex1}>
        {tab === "home" ? (
          <ScrollView contentContainerStyle={styles.screenBody}>
            <GlassCard>
              <View style={styles.logoTitleRow}>
                <Image source={logoSource} style={styles.heroLogo} resizeMode="contain" />
                <View style={styles.flex1}>
                  <Text style={styles.sectionTitle}>{profile?.college_name || "Shree Vedha College"}</Text>
                  <Text style={styles.smallText}>Subject-wise attendance tracking</Text>
                </View>
              </View>
            </GlassCard>
            <GlassCard>
              <Text style={styles.sectionTitle}>Your Subjects</Text>
              {!insights.length ? <Text style={styles.smallText}>No attendance data yet.</Text> : null}
              {insights.map((item) => (
                <View key={item.subject_id} style={styles.percentDetailRow}>
                  <Text style={styles.rowTitle}>{item.subject_name}</Text>
                  <Text style={styles.percentText}>{item.percentage.toFixed(1)}%</Text>
                </View>
              ))}
            </GlassCard>

            <GlassCard>
              <Text style={styles.sectionTitle}>At Risk Subjects (&lt;75%)</Text>
              {!atRiskSubjects.length ? <Text style={styles.smallText}>Great! No at-risk subjects currently.</Text> : null}
              {atRiskSubjects.map((item) => (
                <View key={item.subject_id} style={styles.riskCard}>
                  <Text style={styles.rowTitle}>{item.subject_name}</Text>
                  <Text style={styles.riskText}>{item.percentage.toFixed(1)}%</Text>
                </View>
              ))}
            </GlassCard>
          </ScrollView>
        ) : null}

        {tab === "history" ? (
          <ScrollView contentContainerStyle={styles.screenBody}>
            <GlassCard>
              <Text style={styles.sectionTitle}>Attendance History</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowWrap}>
                <Chip title="All" active={subjectFilter === ""} onPress={() => setSubjectFilter("")} />
                {subjects.map((subject) => (
                  <Chip
                    key={subject.subject_id}
                    title={subject.code}
                    active={subjectFilter === subject.subject_id}
                    onPress={() => setSubjectFilter(subject.subject_id)}
                  />
                ))}
              </ScrollView>

              {filteredAttendance.map((entry) => (
                <View key={entry.record_id} style={styles.rowCard}>
                  <View>
                    <Text style={styles.rowTitle}>{entry.subject_name}</Text>
                    <Text style={styles.smallText}>{formatDate(entry.date)}</Text>
                  </View>
                  <Text style={[styles.statusBadge, entry.status === "present" ? styles.presentBadge : styles.absentBadge]}>
                    {entry.status.toUpperCase()}
                  </Text>
                </View>
              ))}
            </GlassCard>
          </ScrollView>
        ) : null}

        {tab === "insights" ? (
          <ScrollView contentContainerStyle={styles.screenBody}>
            <GlassCard>
              <Text style={styles.sectionTitle}>Detailed Insights</Text>
              {insights.map((item) => (
                <View key={item.subject_id} style={styles.percentDetailRow}>
                  <View>
                    <Text style={styles.rowTitle}>{item.subject_name}</Text>
                    <Text style={styles.smallText}>
                      Present {item.present} / {item.total}
                    </Text>
                  </View>
                  <Text style={styles.percentText}>{item.percentage.toFixed(1)}%</Text>
                </View>
              ))}
            </GlassCard>
          </ScrollView>
        ) : null}

        {tab === "profile" ? (
          <ScrollView contentContainerStyle={styles.screenBody}>
            <GlassCard>
              <Text style={styles.sectionTitle}>Profile</Text>
              <Image source={profileImage ? { uri: profileImage } : LOGO_ASSET} style={styles.profileImage} />
              <PrimaryButton
                title="Upload Profile Picture"
                icon="image"
                variant="secondary"
                onPress={async () => {
                  const image = await pickBase64Image();
                  if (image) setProfileImage(image);
                }}
              />
              <TextField label="Name" value={profileName} onChangeText={setProfileName} placeholder="Your name" />
              <PrimaryButton
                title="Save Profile"
                icon="content-save"
                onPress={async () => {
                  try {
                    await studentUpdateProfile(token, { name: profileName.trim(), profile_image_base64: profileImage });
                    await onSessionRefresh();
                    setMessage("Profile updated");
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Profile update failed");
                  }
                }}
              />
            </GlassCard>

            <GlassCard>
              <Text style={styles.sectionTitle}>Change Password</Text>
              <TextField
                label="Current Password"
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder="Current password"
                secureTextEntry
              />
              <TextField
                label="New Password"
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="New password"
                secureTextEntry
              />
              <PrimaryButton
                title="Change Password"
                icon="lock-reset"
                disabled={!currentPassword.trim() || !newPassword.trim()}
                onPress={async () => {
                  try {
                    await studentChangePassword(token, {
                      current_password: currentPassword.trim(),
                      new_password: newPassword.trim(),
                    });
                    setCurrentPassword("");
                    setNewPassword("");
                    setMessage("Password changed");
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Password change failed");
                  }
                }}
              />
            </GlassCard>
          </ScrollView>
        ) : null}

        {tab === "settings" ? (
          <ScrollView contentContainerStyle={styles.screenBody}>
            <GlassCard>
              <PrimaryButton title="Open Developer" icon="account" variant="secondary" onPress={() => setTab("developer")} />
            </GlassCard>
            <GlassCard>
              <PrimaryButton title="Logout" icon="logout" variant="danger" onPress={() => onLogout()} />
            </GlassCard>
          </ScrollView>
        ) : null}

        {tab === "developer" ? <DeveloperCard /> : null}
      </View>

      <BottomTabs items={tabs} activeKey={tab} onPress={(next) => setTab(next as StudentTab)} />
    </SafeAreaView>
  );
}

function DeveloperCard() {
  return (
    <ScrollView contentContainerStyle={styles.screenBody}>
      <GlassCard>
        <Image source={LOGO_ASSET} style={styles.pendingLogo} resizeMode="contain" />
        <Text style={styles.sectionTitle}>Developer</Text>
        <Text style={styles.rowTitle}>Mohammed Maaz</Text>
        <PrimaryButton
          title="@_themaaz"
          icon="instagram"
          variant="secondary"
          onPress={() => Linking.openURL("https://instagram.com/_themaaz")}
        />
      </GlassCard>
    </ScrollView>
  );
}

function BottomTabs({
  items,
  activeKey,
  onPress,
}: {
  items: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[];
  activeKey: string;
  onPress: (key: string) => void;
}) {
  return (
    <View style={styles.tabBar}>
      {items.map((item) => (
        <Pressable testID={`tab-${item.key}`} key={item.key} style={styles.tabBtn} onPress={() => onPress(item.key)}>
          <Ionicons name={item.icon} size={20} color={activeKey === item.key ? theme.text : theme.mutedText} />
          <Text style={[styles.tabText, activeKey === item.key && styles.tabTextActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Chip({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) {
  const chipId = `chip-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <Pressable testID={chipId} style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

function RoleChip({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) {
  const roleId = `role-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <Pressable testID={roleId} style={[styles.roleChip, active && styles.roleChipActive]} onPress={onPress}>
      <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>{title}</Text>
    </Pressable>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <GlassCard style={styles.statCard}>
      <Text style={styles.smallText}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </GlassCard>
  );
}

function ValidationHint({ text }: { text: string }) {
  return (
    <View style={styles.validationWrap}>
      <MaterialCommunityIcons name="alert-circle-outline" size={14} color={theme.warning} />
      <Text style={styles.validationText}>{text}</Text>
    </View>
  );
}

function MonthGrid({ month, entries }: { month: string; entries: AttendanceRecord[] }) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return <Text style={styles.calendarText}>Invalid month format</Text>;
  }

  const [year, mon] = month.split("-").map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const map = new Map(entries.map((entry) => [entry.date, entry.status]));

  return (
    <View style={styles.calendarGrid}>
      {Array.from({ length: daysInMonth }).map((_, idx) => {
        const day = idx + 1;
        const key = `${month}-${String(day).padStart(2, "0")}`;
        const status = map.get(key);
        return (
          <View
            key={key}
            style={[
              styles.calendarCell,
              status === "present" ? styles.calendarPresent : null,
              status === "absent" ? styles.calendarAbsent : null,
            ]}
          >
            <Text style={styles.calendarCellText}>{day}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safeRoot: { flex: 1, backgroundColor: theme.background },
  loaderScreen: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.background },
  flex1: { flex: 1 },
  centerWrap: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },
  authContainer: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 26,
    gap: 16,
  },
  authLogo: { width: 110, height: 110, alignSelf: "center", borderRadius: 18, backgroundColor: "#fff" },
  authTitle: { color: theme.text, fontSize: 30, lineHeight: 36, textAlign: "center", fontWeight: "800" },
  authCard: { gap: 12 },
  modeRow: { flexDirection: "row", gap: 8, padding: 4, borderRadius: 12, backgroundColor: theme.secondary },
  modeBtn: { flex: 1, minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modeBtnActive: { backgroundColor: theme.primary },
  modeText: { color: theme.mutedText, fontWeight: "700" },
  modeTextActive: { color: theme.text },
  roleChip: {
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.secondary,
  },
  roleChipActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  roleChipText: { color: theme.mutedText, fontWeight: "600" },
  roleChipTextActive: { color: theme.text },
  rowWrap: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  headerRow: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: { color: theme.text, fontWeight: "800", fontSize: 18, maxWidth: 250 },
  headerSubtitle: { color: theme.mutedText, marginTop: 4 },
  refreshBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.secondary,
    justifyContent: "center",
    alignItems: "center",
  },
  messageText: { color: theme.warning, fontWeight: "700", paddingHorizontal: 20 },
  screenBody: { paddingHorizontal: 20, paddingVertical: 20, gap: 14 },
  logoTitleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  heroLogo: { width: 68, height: 68, borderRadius: 12, backgroundColor: "#fff" },
  sectionTitle: { color: theme.text, fontSize: 22, fontWeight: "700" },
  smallText: { color: theme.mutedText, fontSize: 13, lineHeight: 18 },
  statGrid: { gap: 10 },
  statCard: { minHeight: 80, justifyContent: "center", gap: 6 },
  statValue: { color: theme.text, fontSize: 26, fontWeight: "800" },
  listWrap: { gap: 10 },
  rowCard: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(79,151,255,0.08)",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  rowTitle: { color: theme.text, fontSize: 16, fontWeight: "700" },
  chip: {
    minHeight: 44,
    maxWidth: 180,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.secondary,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  chipText: { color: theme.mutedText, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: theme.text },
  wrapContainer: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  selectRow: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(79,151,255,0.1)",
  },
  selectRowActive: { borderColor: theme.success, backgroundColor: "rgba(34,197,94,0.16)" },
  insightCard: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    padding: 10,
    backgroundColor: "rgba(79,151,255,0.1)",
    gap: 6,
    marginTop: 8,
  },
  calendarText: { color: theme.mutedText, fontSize: 12, lineHeight: 16 },
  innerCard: { gap: 6 },
  noticeCard: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(79,151,255,0.1)",
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  noticeRead: { opacity: 0.65 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#fff" },
  pendingCard: { alignItems: "center", gap: 10 },
  pendingLogo: { width: 84, height: 84, borderRadius: 12, backgroundColor: "#fff" },
  tabBar: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: "rgba(226,240,255,0.96)",
    flexDirection: "row",
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: Platform.select({ ios: 20, android: 10, default: 10 }),
  },
  tabBtn: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 2 },
  tabText: { color: theme.mutedText, fontSize: 10, fontWeight: "700" },
  tabTextActive: { color: theme.text },
  percentText: { color: theme.success, fontWeight: "800", fontSize: 17 },
  percentDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingVertical: 10,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    color: theme.text,
    fontWeight: "800",
    fontSize: 11,
    overflow: "hidden",
  },
  presentBadge: { backgroundColor: "rgba(34,197,94,0.8)" },
  absentBadge: { backgroundColor: "rgba(239,68,68,0.8)" },
  profileImage: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "#fff",
    alignSelf: "center",
  },
  riskCard: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 10,
    backgroundColor: "rgba(236,247,255,0.8)",
    gap: 6,
  },
  riskText: {
    color: theme.danger,
    fontWeight: "800",
    fontSize: 13,
  },
  validationWrap: {
    borderRadius: 999,
    backgroundColor: "rgba(242,169,59,0.15)",
    borderWidth: 1,
    borderColor: "rgba(242,169,59,0.45)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  validationText: {
    color: theme.warning,
    fontSize: 12,
    fontWeight: "700",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  calendarCell: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(223,238,255,0.8)",
  },
  calendarPresent: {
    backgroundColor: "rgba(30,166,114,0.2)",
    borderColor: theme.success,
  },
  calendarAbsent: {
    backgroundColor: "rgba(229,84,84,0.2)",
    borderColor: theme.danger,
  },
  calendarCellText: {
    color: theme.text,
    fontSize: 11,
    fontWeight: "700",
  },
});

export default function MainAppRoute() {
  return null;
}
