import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LineChart, PieChart } from "react-native-chart-kit";
import * as Linking from "expo-linking";

import { GlassCard } from "./components/GlassCard";
import { LoaderSkeleton } from "./components/LoaderSkeleton";
import { PrimaryButton } from "./components/PrimaryButton";
import { TextField } from "./components/TextField";
import {
  AUTH_BACKGROUND_IMAGE,
  DASHBOARD_HERO_IMAGE,
  DEVELOPER_BACKGROUND_IMAGE,
} from "./constants/embeddedImages";
import { theme } from "./constants/theme";
import {
  approveStudent,
  createCourse,
  createSemester,
  deleteAttendance,
  getAdminAnalytics,
  getAdminAttendance,
  getApprovedStudents,
  getCourses,
  getMe,
  getPendingStudents,
  getSemesters,
  getStudentAnalytics,
  getStudentAttendance,
  getStudentCourses,
  login,
  markAttendance,
  signUp,
  updateAttendance,
} from "./services/api";
import { AnalyticsResponse, AttendanceRecord, Course, PendingStudent, Semester, User } from "./types";

type Session = {
  token: string;
  user: User;
};

type AdminTab = "dashboard" | "manage" | "insights" | "settings" | "developer";
type StudentTab = "dashboard" | "attendance" | "insights" | "settings" | "developer";

const SESSION_KEY = "svam_session";

const defaultAnalytics: AnalyticsResponse = {
  overall_present: 0,
  overall_total: 0,
  overall_percentage: 0,
  courses: [],
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return Number.isNaN(date.getTime()) ? dateString : date.toLocaleDateString();
};

const today = () => new Date().toISOString().slice(0, 10);

export default function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [isBootLoading, setIsBootLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [approvalCheckBusy, setApprovalCheckBusy] = useState(false);

  useEffect(() => {
    const restore = async () => {
      try {
        const cached = await AsyncStorage.getItem(SESSION_KEY);
        if (!cached) {
          return;
        }
        const parsed = JSON.parse(cached) as Session;
        setSession(parsed);
      } catch {
        await AsyncStorage.removeItem(SESSION_KEY);
      } finally {
        setIsBootLoading(false);
      }
    };

    restore();
  }, []);

  const persistSession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    if (nextSession) {
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      return;
    }
    await AsyncStorage.removeItem(SESSION_KEY);
  }, []);

  const handleLogin = useCallback(
    async (payload: { email: string; password: string }) => {
      setAuthBusy(true);
      setAuthMessage("");
      try {
        const response = await login(payload);
        await persistSession({ token: response.access_token, user: response.user });
        setAuthMessage(response.message);
      } catch (error) {
        setAuthMessage(error instanceof Error ? error.message : "Unable to login");
      } finally {
        setAuthBusy(false);
      }
    },
    [persistSession]
  );

  const handleSignup = useCallback(
    async (payload: {
      name: string;
      email: string;
      password: string;
      role: "college" | "student";
      college_name: string;
    }) => {
      setAuthBusy(true);
      setAuthMessage("");
      try {
        const response = await signUp(payload);
        await persistSession({ token: response.access_token, user: response.user });
        setAuthMessage(response.message);
      } catch (error) {
        setAuthMessage(error instanceof Error ? error.message : "Unable to sign up");
      } finally {
        setAuthBusy(false);
      }
    },
    [persistSession]
  );

  const handleLogout = useCallback(async () => {
    await persistSession(null);
  }, [persistSession]);

  const refreshApprovalState = useCallback(async () => {
    if (!session) {
      return;
    }

    setApprovalCheckBusy(true);
    try {
      const latestUser = await getMe(session.token);
      const nextSession = { ...session, user: latestUser };
      await persistSession(nextSession);
      setAuthMessage(latestUser.approved ? "Approved! Welcome in 🎉" : "Still pending approval");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Unable to refresh status");
    } finally {
      setApprovalCheckBusy(false);
    }
  }, [persistSession, session]);

  if (isBootLoading) {
    return (
      <SafeAreaView style={styles.bootLoader}>
        <ActivityIndicator size="large" color={theme.primary} />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <AuthScreen
        busy={authBusy}
        message={authMessage}
        onLogin={handleLogin}
        onSignup={handleSignup}
      />
    );
  }

  if (session.user.role === "student" && !session.user.approved) {
    return (
      <PendingApprovalScreen
        user={session.user}
        checking={approvalCheckBusy}
        message={authMessage}
        onCheckApproval={refreshApprovalState}
        onLogout={handleLogout}
      />
    );
  }

  if (session.user.role === "college") {
    return <AdminShell user={session.user} token={session.token} onLogout={handleLogout} />;
  }

  return <StudentShell user={session.user} token={session.token} onLogout={handleLogout} />;
}

function AuthScreen({
  onLogin,
  onSignup,
  busy,
  message,
}: {
  onLogin: (payload: { email: string; password: string }) => Promise<void>;
  onSignup: (payload: {
    name: string;
    email: string;
    password: string;
    role: "college" | "student";
    college_name: string;
  }) => Promise<void>;
  busy: boolean;
  message: string;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [role, setRole] = useState<"college" | "student">("college");
  const [name, setName] = useState("");
  const [collegeName, setCollegeName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submitDisabled = useMemo(() => {
    if (!email.trim() || !password.trim()) {
      return true;
    }
    if (mode === "signup") {
      return !name.trim() || !collegeName.trim();
    }
    return false;
  }, [collegeName, email, mode, name, password]);

  return (
    <ImageBackground source={{ uri: AUTH_BACKGROUND_IMAGE }} style={styles.flex} resizeMode="cover">
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.authTitle}>Shree vedha attendance management</Text>
            <Text style={styles.authSubtitle}>Premium dark attendance app for college & students</Text>

            <GlassCard style={styles.authCard}>
              <View style={styles.modeRow}>
                <Pressable
                  testID="mode-login"
                  onPress={() => setMode("login")}
                  style={[styles.modeButton, mode === "login" && styles.modeButtonActive]}
                >
                  <Text style={[styles.modeText, mode === "login" && styles.modeTextActive]}>Login</Text>
                </Pressable>
                <Pressable
                  testID="mode-signup"
                  onPress={() => setMode("signup")}
                  style={[styles.modeButton, mode === "signup" && styles.modeButtonActive]}
                >
                  <Text style={[styles.modeText, mode === "signup" && styles.modeTextActive]}>Sign Up</Text>
                </Pressable>
              </View>

              {mode === "signup" ? (
                <>
                  <TextField label="Full name" value={name} onChangeText={setName} placeholder="Enter your full name" />
                  <TextField
                    label="College name"
                    value={collegeName}
                    onChangeText={setCollegeName}
                    placeholder="Example: Shree Vedha College"
                  />

                  <View style={styles.roleSelector}>
                    <Text style={styles.fieldTitle}>Role</Text>
                    <View style={styles.roleButtonsWrap}>
                      <RoleChip active={role === "college"} title="College Admin" onPress={() => setRole("college")} />
                      <RoleChip active={role === "student"} title="Student" onPress={() => setRole("student")} />
                    </View>
                  </View>
                </>
              ) : null}

              <TextField
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <TextField
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="Minimum 6 characters"
                secureTextEntry
              />

              {message ? <Text style={styles.messageText}>{message}</Text> : null}

              <PrimaryButton
                testID="auth-submit"
                title={mode === "login" ? "Login" : "Create account"}
                icon="login"
                loading={busy}
                disabled={submitDisabled}
                onPress={() => {
                  if (mode === "login") {
                    onLogin({ email: email.trim(), password: password.trim() });
                    return;
                  }
                  onSignup({
                    name: name.trim(),
                    email: email.trim(),
                    password: password.trim(),
                    role,
                    college_name: collegeName.trim(),
                  });
                }}
              />
            </GlassCard>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ImageBackground>
  );
}

function PendingApprovalScreen({
  user,
  checking,
  message,
  onCheckApproval,
  onLogout,
}: {
  user: User;
  checking: boolean;
  message: string;
  onCheckApproval: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  return (
    <SafeAreaView style={styles.mainSafe}>
      <View style={styles.pendingWrap}>
        <GlassCard style={styles.pendingCard}>
          <MaterialCommunityIcons name="clock-alert" size={40} color={theme.warning} />
          <Text style={styles.pendingTitle}>Approval Pending</Text>
          <Text style={styles.pendingText}>
            Hi {user.name}, your college admin needs to approve your account to unlock attendance data.
          </Text>
          <Text style={styles.pendingText}>College: {user.college_name}</Text>

          {message ? <Text style={styles.messageText}>{message}</Text> : null}

          <View style={styles.pendingActions}>
            <PrimaryButton
              testID="check-approval"
              title="Check Approval"
              icon="refresh"
              loading={checking}
              onPress={onCheckApproval}
            />
            <PrimaryButton
              title="Logout"
              icon="logout"
              variant="secondary"
              onPress={() => {
                onLogout();
              }}
            />
          </View>
        </GlassCard>
      </View>
    </SafeAreaView>
  );
}

function AdminShell({ user, token, onLogout }: { user: User; token: string; onLogout: () => Promise<void> }) {
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const [pendingStudents, setPendingStudents] = useState<PendingStudent[]>([]);
  const [students, setStudents] = useState<User[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsResponse>(defaultAnalytics);

  const [semesterName, setSemesterName] = useState("");
  const [selectedSemester, setSelectedSemester] = useState("");
  const [courseName, setCourseName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [selectedCourse, setSelectedCourse] = useState("");
  const [selectedStudent, setSelectedStudent] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(today());
  const [attendanceStatus, setAttendanceStatus] = useState<"present" | "absent">("present");

  const cacheKey = `svam_admin_cache_${user.user_id}`;
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(width - 76, 270);

  const loadAll = useCallback(async () => {
    setBusy(true);
    try {
      const [pending, approved, semestersData, coursesData, attendanceData, analyticsData] = await Promise.all([
        getPendingStudents(token),
        getApprovedStudents(token),
        getSemesters(token),
        getCourses(token),
        getAdminAttendance(token),
        getAdminAnalytics(token),
      ]);

      setPendingStudents(pending);
      setStudents(approved);
      setSemesters(semestersData);
      setCourses(coursesData);
      setAttendance(attendanceData);
      setAnalytics(analyticsData);

      await AsyncStorage.setItem(
        cacheKey,
        JSON.stringify({
          pending,
          approved,
          semestersData,
          coursesData,
          attendanceData,
          analyticsData,
        })
      );

      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load admin data");
    } finally {
      setBusy(false);
    }
  }, [cacheKey, token]);

  useEffect(() => {
    const init = async () => {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (!cached) {
        loadAll();
        return;
      }
      try {
        const parsed = JSON.parse(cached) as {
          pending: PendingStudent[];
          approved: User[];
          semestersData: Semester[];
          coursesData: Course[];
          attendanceData: AttendanceRecord[];
          analyticsData: AnalyticsResponse;
        };
        setPendingStudents(parsed.pending);
        setStudents(parsed.approved);
        setSemesters(parsed.semestersData);
        setCourses(parsed.coursesData);
        setAttendance(parsed.attendanceData);
        setAnalytics(parsed.analyticsData);
      } catch {
        await AsyncStorage.removeItem(cacheKey);
      }
      loadAll();
    };

    init();
  }, [cacheKey, loadAll]);

  useEffect(() => {
    if (!selectedSemester && semesters[0]?.semester_id) {
      setSelectedSemester(semesters[0].semester_id);
    }
  }, [selectedSemester, semesters]);

  useEffect(() => {
    if (!selectedCourse && courses[0]?.course_id) {
      setSelectedCourse(courses[0].course_id);
    }
  }, [courses, selectedCourse]);

  useEffect(() => {
    if (!selectedStudent && students[0]?.user_id) {
      setSelectedStudent(students[0].user_id);
    }
  }, [selectedStudent, students]);

  const adminTabs: Array<{ key: AdminTab; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
    { key: "dashboard", label: "Home", icon: "home-outline" },
    { key: "manage", label: "Manage", icon: "create-outline" },
    { key: "insights", label: "Insights", icon: "stats-chart-outline" },
    { key: "settings", label: "Settings", icon: "settings-outline" },
    { key: "developer", label: "Developer", icon: "code-slash-outline" },
  ];

  const markNewAttendance = async () => {
    if (!selectedCourse || !selectedStudent || !attendanceDate.trim()) {
      setMessage("Pick course, student and date first");
      return;
    }
    setBusy(true);
    try {
      await markAttendance(token, {
        course_id: selectedCourse,
        student_id: selectedStudent,
        date: attendanceDate,
        status: attendanceStatus,
      });
      setMessage("Attendance saved");
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to mark attendance");
      setBusy(false);
    }
  };

  const addSemester = async () => {
    if (!semesterName.trim()) {
      setMessage("Enter semester name");
      return;
    }
    setBusy(true);
    try {
      await createSemester(token, semesterName.trim());
      setSemesterName("");
      setMessage("Semester created");
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create semester");
      setBusy(false);
    }
  };

  const addCourse = async () => {
    if (!selectedSemester || !courseName.trim() || !courseCode.trim()) {
      setMessage("Select semester, then add course name and code");
      return;
    }
    setBusy(true);
    try {
      await createCourse(token, {
        semester_id: selectedSemester,
        name: courseName.trim(),
        code: courseCode.trim(),
      });
      setCourseName("");
      setCourseCode("");
      setMessage("Course created");
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create course");
      setBusy(false);
    }
  };

  const approve = async (studentId: string) => {
    setBusy(true);
    try {
      await approveStudent(token, studentId);
      setMessage("Student approved");
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to approve student");
      setBusy(false);
    }
  };

  const toggleAttendance = async (item: AttendanceRecord) => {
    setBusy(true);
    try {
      const nextStatus = item.status === "present" ? "absent" : "present";
      await updateAttendance(token, item.record_id, nextStatus);
      setMessage("Attendance updated");
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update attendance");
      setBusy(false);
    }
  };

  const removeAttendance = async (recordId: string) => {
    setBusy(true);
    try {
      await deleteAttendance(token, recordId);
      setMessage("Record deleted");
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete attendance");
      setBusy(false);
    }
  };

  const filteredHistory = attendance.filter((item) => {
    if (selectedCourse && item.course_id !== selectedCourse) return false;
    if (selectedStudent && item.student_id !== selectedStudent) return false;
    return true;
  });

  const dashboardBody = (
    <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
      <ImageBackground source={{ uri: DASHBOARD_HERO_IMAGE }} style={styles.heroCard} imageStyle={styles.heroImage}>
        <Text style={styles.heroTitle}>College Admin Hub</Text>
        <Text style={styles.heroSubtitle}>Track attendance, approve students, and monitor quality.</Text>
      </ImageBackground>

      <View style={styles.statsGrid}>
        <StatCard title="Pending approvals" value={pendingStudents.length.toString()} accent={theme.warning} />
        <StatCard title="Courses" value={courses.length.toString()} accent={theme.primary} />
        <StatCard title="Overall attendance" value={`${analytics.overall_percentage.toFixed(1)}%`} accent={theme.success} />
      </View>

      <GlassCard>
        <View style={styles.sectionHeadRow}>
          <Text style={styles.sectionTitle}>Pending Student Approvals</Text>
          <PrimaryButton title="Refresh" icon="refresh" variant="secondary" onPress={loadAll} disabled={busy} />
        </View>

        {busy && pendingStudents.length === 0 ? <LoaderSkeleton /> : null}

        {!pendingStudents.length && !busy ? <Text style={styles.emptyText}>No pending approvals right now.</Text> : null}

        <View style={styles.listWrap}>
          {pendingStudents.map((student, index) => (
            <GlassCard delay={index * 30} style={styles.rowCard} key={student.user_id}>
              <View style={styles.rowHeader}>
                <View>
                  <Text style={styles.rowTitle}>{student.name}</Text>
                  <Text style={styles.rowMeta}>{student.email}</Text>
                </View>
                <PrimaryButton title="Approve" icon="check" onPress={() => approve(student.user_id)} disabled={busy} />
              </View>
            </GlassCard>
          ))}
        </View>
      </GlassCard>
    </ScrollView>
  );

  const manageBody = (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
        <GlassCard>
          <Text style={styles.sectionTitle}>Create Semester</Text>
          <TextField label="Semester name" value={semesterName} onChangeText={setSemesterName} placeholder="Example: Semester 1" />
          <PrimaryButton title="Add Semester" icon="plus" onPress={addSemester} disabled={busy} testID="add-semester-btn" />
        </GlassCard>

        <GlassCard>
          <Text style={styles.sectionTitle}>Create Course</Text>
          <Text style={styles.sectionNote}>Select semester</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {semesters.map((semester) => (
              <Chip
                key={semester.semester_id}
                active={selectedSemester === semester.semester_id}
                title={semester.name}
                onPress={() => setSelectedSemester(semester.semester_id)}
              />
            ))}
          </ScrollView>
          <TextField label="Course name" value={courseName} onChangeText={setCourseName} placeholder="Engineering Maths" />
          <TextField label="Course code" value={courseCode} onChangeText={setCourseCode} placeholder="MATH101" />
          <PrimaryButton title="Add Course" icon="book-plus" onPress={addCourse} disabled={busy} testID="add-course-btn" />
        </GlassCard>

        <GlassCard>
          <Text style={styles.sectionTitle}>Mark Attendance</Text>

          <Text style={styles.sectionNote}>Choose course</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {courses.map((course) => (
              <Chip
                key={course.course_id}
                active={selectedCourse === course.course_id}
                title={course.code}
                onPress={() => setSelectedCourse(course.course_id)}
              />
            ))}
          </ScrollView>

          <Text style={styles.sectionNote}>Choose student</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {students.map((student) => (
              <Chip
                key={student.user_id}
                active={selectedStudent === student.user_id}
                title={student.name}
                onPress={() => setSelectedStudent(student.user_id)}
              />
            ))}
          </ScrollView>

          <TextField label="Date (YYYY-MM-DD)" value={attendanceDate} onChangeText={setAttendanceDate} placeholder="2026-03-14" />

          <View style={styles.rowGap}>
            <Text style={styles.sectionNote}>Status</Text>
            <View style={styles.roleButtonsWrap}>
              <RoleChip
                active={attendanceStatus === "present"}
                title="Present"
                onPress={() => setAttendanceStatus("present")}
              />
              <RoleChip
                active={attendanceStatus === "absent"}
                title="Absent"
                onPress={() => setAttendanceStatus("absent")}
              />
            </View>
          </View>

          <PrimaryButton title="Save Attendance" icon="check-circle" onPress={markNewAttendance} disabled={busy} />
        </GlassCard>

        <GlassCard>
          <Text style={styles.sectionTitle}>Editable Attendance History</Text>
          {!filteredHistory.length ? <Text style={styles.emptyText}>No records match selected filters.</Text> : null}
          <View style={styles.listWrap}>
            {filteredHistory.slice(0, 40).map((item) => (
              <View key={item.record_id} style={styles.historyCard}>
                <View style={styles.historyHeader}>
                  <Text style={styles.rowTitle}>{item.course_name}</Text>
                  <Text style={[styles.statusPill, item.status === "present" ? styles.presentPill : styles.absentPill]}>
                    {item.status.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.rowMeta}>
                  {item.student_name} • {formatDate(item.date)}
                </Text>
                <View style={styles.historyActions}>
                  <PrimaryButton
                    title="Toggle"
                    variant="secondary"
                    icon="swap-horizontal"
                    onPress={() => toggleAttendance(item)}
                    disabled={busy}
                  />
                  <PrimaryButton
                    title="Delete"
                    variant="danger"
                    icon="delete"
                    onPress={() => removeAttendance(item.record_id)}
                    disabled={busy}
                  />
                </View>
              </View>
            ))}
          </View>
        </GlassCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const insightsBody = (
    <ScrollView contentContainerStyle={styles.scrollBody}>
      <GlassCard>
        <Text style={styles.sectionTitle}>Attendance Distribution</Text>
        {analytics.overall_total ? (
          <PieChart
            data={[
              {
                name: "Present",
                population: analytics.overall_present,
                color: theme.success,
                legendFontColor: theme.text,
                legendFontSize: 12,
              },
              {
                name: "Absent",
                population: analytics.overall_total - analytics.overall_present,
                color: theme.danger,
                legendFontColor: theme.text,
                legendFontSize: 12,
              },
            ]}
            width={chartWidth}
            height={210}
            chartConfig={chartConfig}
            accessor="population"
            backgroundColor="transparent"
            paddingLeft="12"
            absolute
          />
        ) : (
          <Text style={styles.emptyText}>No attendance marked yet.</Text>
        )}
      </GlassCard>

      <GlassCard>
        <Text style={styles.sectionTitle}>Course Percentage Trend</Text>
        {analytics.courses.length ? (
          <LineChart
            data={{
              labels: analytics.courses.map((item) => item.course_name.slice(0, 6)),
              datasets: [{ data: analytics.courses.map((item) => item.percentage || 0) }],
            }}
            width={chartWidth}
            height={220}
            chartConfig={chartConfig}
            bezier
            yAxisSuffix="%"
            style={styles.chart}
          />
        ) : (
          <Text style={styles.emptyText}>Course analytics appear after marking attendance.</Text>
        )}
      </GlassCard>
    </ScrollView>
  );

  const settingsBody = (
    <ScrollView contentContainerStyle={styles.scrollBody}>
      <GlassCard>
        <Text style={styles.sectionTitle}>Admin Settings</Text>
        <Text style={styles.rowMeta}>College: {user.college_name}</Text>
        <Text style={styles.rowMeta}>Admin: {user.name}</Text>
        <Text style={styles.rowMeta}>Students: {students.length}</Text>
      </GlassCard>

      <GlassCard>
        <PrimaryButton
          title="Open Developer Profile"
          icon="account-circle"
          variant="secondary"
          onPress={() => setActiveTab("developer")}
        />
      </GlassCard>

      <GlassCard>
        <PrimaryButton title="Logout" icon="logout" variant="danger" onPress={() => onLogout()} />
      </GlassCard>
    </ScrollView>
  );

  const developerBody = <DeveloperCard />;

  return (
    <SafeAreaView style={styles.mainSafe}>
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.appName}>Shree vedha attendance management</Text>
          <Text style={styles.welcomeText}>Welcome, {user.name}</Text>
        </View>
        <View style={styles.headerAction}>
          <Pressable onPress={loadAll} style={styles.iconBtn}>
            <Ionicons name="refresh" size={20} color={theme.text} />
          </Pressable>
        </View>
      </View>

      {message ? <Text style={styles.banner}>{message}</Text> : null}

      <View style={styles.flex}>
        {activeTab === "dashboard" && dashboardBody}
        {activeTab === "manage" && manageBody}
        {activeTab === "insights" && insightsBody}
        {activeTab === "settings" && settingsBody}
        {activeTab === "developer" && developerBody}
      </View>

      <BottomTabs items={adminTabs} activeKey={activeTab} onPress={(next) => setActiveTab(next as AdminTab)} />
    </SafeAreaView>
  );
}

function StudentShell({ user, token, onLogout }: { user: User; token: string; onLogout: () => Promise<void> }) {
  const [activeTab, setActiveTab] = useState<StudentTab>("dashboard");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsResponse>(defaultAnalytics);
  const [courseFilter, setCourseFilter] = useState("");

  const cacheKey = `svam_student_cache_${user.user_id}`;
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(width - 76, 270);

  const loadAll = useCallback(async () => {
    setBusy(true);
    try {
      const [coursesData, historyData, analyticsData] = await Promise.all([
        getStudentCourses(token),
        getStudentAttendance(token),
        getStudentAnalytics(token),
      ]);

      setCourses(coursesData);
      setHistory(historyData);
      setAnalytics(analyticsData);

      await AsyncStorage.setItem(cacheKey, JSON.stringify({ coursesData, historyData, analyticsData }));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load student data");
    } finally {
      setBusy(false);
    }
  }, [cacheKey, token]);

  useEffect(() => {
    const init = async () => {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as {
            coursesData: Course[];
            historyData: AttendanceRecord[];
            analyticsData: AnalyticsResponse;
          };
          setCourses(parsed.coursesData);
          setHistory(parsed.historyData);
          setAnalytics(parsed.analyticsData);
        } catch {
          await AsyncStorage.removeItem(cacheKey);
        }
      }
      loadAll();
    };

    init();
  }, [cacheKey, loadAll]);

  const studentTabs: Array<{ key: StudentTab; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
    { key: "dashboard", label: "Home", icon: "home-outline" },
    { key: "attendance", label: "History", icon: "calendar-outline" },
    { key: "insights", label: "Insights", icon: "analytics-outline" },
    { key: "settings", label: "Settings", icon: "settings-outline" },
    { key: "developer", label: "Developer", icon: "code-slash-outline" },
  ];

  const filteredHistory = history.filter((item) => {
    if (!courseFilter) return true;
    return item.course_id === courseFilter;
  });

  const dashboardBody = (
    <ScrollView contentContainerStyle={styles.scrollBody}>
      <ImageBackground source={{ uri: DASHBOARD_HERO_IMAGE }} style={styles.heroCard} imageStyle={styles.heroImage}>
        <Text style={styles.heroTitle}>Student Dashboard</Text>
        <Text style={styles.heroSubtitle}>Your attendance at a glance, updated by college approval.</Text>
      </ImageBackground>

      <View style={styles.statsGrid}>
        <StatCard title="Overall Attendance" value={`${analytics.overall_percentage.toFixed(1)}%`} accent={theme.success} />
        <StatCard title="Total Classes" value={analytics.overall_total.toString()} accent={theme.primary} />
        <StatCard title="Courses" value={courses.length.toString()} accent={theme.warning} />
      </View>

      <GlassCard>
        <Text style={styles.sectionTitle}>Course-wise Attendance</Text>
        {busy && !analytics.courses.length ? <LoaderSkeleton /> : null}
        {!analytics.courses.length && !busy ? <Text style={styles.emptyText}>No attendance records yet.</Text> : null}
        <View style={styles.listWrap}>
          {analytics.courses.map((item) => (
            <View key={item.course_id} style={styles.courseStatRow}>
              <View>
                <Text style={styles.rowTitle}>{item.course_name}</Text>
                <Text style={styles.rowMeta}>
                  Present {item.present} / {item.total}
                </Text>
              </View>
              <Text style={styles.percentText}>{item.percentage.toFixed(1)}%</Text>
            </View>
          ))}
        </View>
      </GlassCard>
    </ScrollView>
  );

  const historyBody = (
    <ScrollView contentContainerStyle={styles.scrollBody}>
      <GlassCard>
        <Text style={styles.sectionTitle}>Attendance History</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          <Chip active={courseFilter === ""} title="All" onPress={() => setCourseFilter("")} />
          {courses.map((course) => (
            <Chip
              key={course.course_id}
              active={courseFilter === course.course_id}
              title={course.code}
              onPress={() => setCourseFilter(course.course_id)}
            />
          ))}
        </ScrollView>

        {!filteredHistory.length ? <Text style={styles.emptyText}>No history for this filter.</Text> : null}

        <View style={styles.listWrap}>
          {filteredHistory.map((item) => (
            <View key={item.record_id} style={styles.historyCard}>
              <View style={styles.historyHeader}>
                <Text style={styles.rowTitle}>{item.course_name}</Text>
                <Text style={[styles.statusPill, item.status === "present" ? styles.presentPill : styles.absentPill]}>
                  {item.status.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.rowMeta}>{formatDate(item.date)}</Text>
            </View>
          ))}
        </View>
      </GlassCard>
    </ScrollView>
  );

  const insightsBody = (
    <ScrollView contentContainerStyle={styles.scrollBody}>
      <GlassCard>
        <Text style={styles.sectionTitle}>Present vs Absent</Text>
        {analytics.overall_total ? (
          <PieChart
            data={[
              {
                name: "Present",
                population: analytics.overall_present,
                color: theme.success,
                legendFontColor: theme.text,
                legendFontSize: 12,
              },
              {
                name: "Absent",
                population: analytics.overall_total - analytics.overall_present,
                color: theme.danger,
                legendFontColor: theme.text,
                legendFontSize: 12,
              },
            ]}
            width={chartWidth}
            height={210}
            chartConfig={chartConfig}
            accessor="population"
            backgroundColor="transparent"
            paddingLeft="12"
            absolute
          />
        ) : (
          <Text style={styles.emptyText}>Your chart appears once attendance is marked.</Text>
        )}
      </GlassCard>

      <GlassCard>
        <Text style={styles.sectionTitle}>Course Trend</Text>
        {analytics.courses.length ? (
          <LineChart
            data={{
              labels: analytics.courses.map((item) => item.course_name.slice(0, 6)),
              datasets: [{ data: analytics.courses.map((item) => item.percentage || 0) }],
            }}
            width={chartWidth}
            height={220}
            chartConfig={chartConfig}
            bezier
            yAxisSuffix="%"
            style={styles.chart}
          />
        ) : (
          <Text style={styles.emptyText}>No trend data yet.</Text>
        )}
      </GlassCard>
    </ScrollView>
  );

  const settingsBody = (
    <ScrollView contentContainerStyle={styles.scrollBody}>
      <GlassCard>
        <Text style={styles.sectionTitle}>Student Settings</Text>
        <Text style={styles.rowMeta}>Student: {user.name}</Text>
        <Text style={styles.rowMeta}>College: {user.college_name}</Text>
      </GlassCard>
      <GlassCard>
        <PrimaryButton
          title="Open Developer Profile"
          icon="account-circle"
          variant="secondary"
          onPress={() => setActiveTab("developer")}
        />
      </GlassCard>
      <GlassCard>
        <PrimaryButton title="Logout" icon="logout" variant="danger" onPress={() => onLogout()} />
      </GlassCard>
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.mainSafe}>
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.appName}>Shree vedha attendance management</Text>
          <Text style={styles.welcomeText}>Hello, {user.name}</Text>
        </View>
        <Pressable onPress={loadAll} style={styles.iconBtn}>
          <Ionicons name="refresh" size={20} color={theme.text} />
        </Pressable>
      </View>

      {message ? <Text style={styles.banner}>{message}</Text> : null}

      <View style={styles.flex}>
        {activeTab === "dashboard" && dashboardBody}
        {activeTab === "attendance" && historyBody}
        {activeTab === "insights" && insightsBody}
        {activeTab === "settings" && settingsBody}
        {activeTab === "developer" && <DeveloperCard />}
      </View>

      <BottomTabs items={studentTabs} activeKey={activeTab} onPress={(next) => setActiveTab(next as StudentTab)} />
    </SafeAreaView>
  );
}

function BottomTabs({
  items,
  activeKey,
  onPress,
}: {
  items: Array<{ key: string; label: string; icon: keyof typeof Ionicons.glyphMap }>;
  activeKey: string;
  onPress: (key: string) => void;
}) {
  return (
    <View style={styles.tabBar}>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Pressable key={item.key} testID={`tab-${item.key}`} onPress={() => onPress(item.key)} style={styles.tabBtn}>
            <Ionicons name={item.icon} size={20} color={active ? theme.text : theme.mutedText} />
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Chip({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{title}</Text>
    </Pressable>
  );
}

function RoleChip({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.roleChip, active && styles.roleChipActive]}>
      <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>{title}</Text>
    </Pressable>
  );
}

function StatCard({ title, value, accent }: { title: string; value: string; accent: string }) {
  return (
    <GlassCard style={styles.statCard}>
      <Text style={styles.statTitle}>{title}</Text>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
    </GlassCard>
  );
}

function DeveloperCard() {
  return (
    <ImageBackground source={{ uri: DEVELOPER_BACKGROUND_IMAGE }} style={styles.flex} resizeMode="cover">
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <GlassCard>
          <Text style={styles.sectionTitle}>Developer</Text>
          <Text style={styles.rowTitle}>Mohammed Maaz</Text>
          <Text style={styles.rowMeta}>Premium UI crafted for college attendance management</Text>
          <PrimaryButton
            title="@_themaaz"
            icon="instagram"
            variant="secondary"
            onPress={() => Linking.openURL("https://instagram.com/_themaaz")}
          />
        </GlassCard>
      </ScrollView>
    </ImageBackground>
  );
}

const chartConfig = {
  backgroundGradientFrom: theme.card,
  backgroundGradientTo: theme.card,
  decimalPlaces: 0,
  color: (opacity = 1) => `rgba(99, 102, 241, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(250, 250, 250, ${opacity})`,
  propsForDots: {
    r: "4",
    strokeWidth: "2",
    stroke: theme.primary,
  },
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  mainSafe: {
    flex: 1,
    backgroundColor: theme.background,
    paddingTop: 10,
    paddingBottom: 10,
  },
  bootLoader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.background,
  },
  authScroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 30,
    gap: 20,
  },
  authTitle: {
    color: theme.text,
    fontSize: 32,
    fontWeight: "800",
    lineHeight: 38,
  },
  authSubtitle: {
    color: theme.mutedText,
    fontSize: 15,
  },
  authCard: {
    gap: 14,
  },
  modeRow: {
    flexDirection: "row",
    backgroundColor: "rgba(39,39,42,0.7)",
    borderRadius: 12,
    padding: 4,
    gap: 8,
  },
  modeButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  modeButtonActive: {
    backgroundColor: theme.primary,
  },
  modeText: {
    color: theme.mutedText,
    fontWeight: "600",
    fontSize: 14,
  },
  modeTextActive: {
    color: theme.text,
  },
  roleSelector: {
    gap: 8,
  },
  fieldTitle: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "600",
  },
  roleButtonsWrap: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  roleChip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: "rgba(39,39,42,0.6)",
  },
  roleChipActive: {
    backgroundColor: "rgba(99,102,241,0.25)",
    borderColor: theme.primary,
  },
  roleChipText: {
    color: theme.mutedText,
    fontWeight: "600",
  },
  roleChipTextActive: {
    color: theme.text,
  },
  messageText: {
    color: theme.warning,
    fontSize: 13,
    fontWeight: "600",
  },
  pendingWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 28,
  },
  pendingCard: {
    gap: 12,
    alignItems: "flex-start",
  },
  pendingTitle: {
    color: theme.text,
    fontSize: 26,
    fontWeight: "700",
  },
  pendingText: {
    color: theme.mutedText,
    fontSize: 15,
    lineHeight: 21,
  },
  pendingActions: {
    width: "100%",
    gap: 10,
  },
  pageHeader: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  appName: {
    color: theme.text,
    fontSize: 18,
    fontWeight: "800",
    maxWidth: 270,
  },
  welcomeText: {
    color: theme.mutedText,
    fontSize: 13,
    marginTop: 4,
  },
  headerAction: {
    flexDirection: "row",
  },
  iconBtn: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: "rgba(39,39,42,0.8)",
  },
  banner: {
    color: theme.warning,
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  scrollBody: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 16,
  },
  heroCard: {
    minHeight: 144,
    borderRadius: 22,
    overflow: "hidden",
    padding: 18,
    justifyContent: "flex-end",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  heroImage: {
    opacity: 0.7,
  },
  heroTitle: {
    color: theme.text,
    fontSize: 24,
    fontWeight: "800",
  },
  heroSubtitle: {
    color: theme.text,
    fontSize: 14,
    marginTop: 6,
    opacity: 0.85,
  },
  statsGrid: {
    gap: 12,
  },
  statCard: {
    minHeight: 90,
    justifyContent: "center",
    gap: 8,
  },
  statTitle: {
    color: theme.mutedText,
    fontSize: 13,
  },
  statValue: {
    fontSize: 26,
    fontWeight: "800",
  },
  sectionHeadRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sectionTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: "700",
  },
  sectionNote: {
    color: theme.mutedText,
    fontSize: 13,
    marginBottom: 4,
  },
  listWrap: {
    gap: 10,
  },
  rowCard: {
    padding: 12,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  rowTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: "700",
  },
  rowMeta: {
    color: theme.mutedText,
    fontSize: 13,
    marginTop: 2,
  },
  chipsRow: {
    gap: 10,
    paddingVertical: 4,
    paddingRight: 20,
  },
  chip: {
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: "rgba(39,39,42,0.7)",
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  chipActive: {
    borderColor: theme.primary,
    backgroundColor: "rgba(99,102,241,0.25)",
  },
  chipText: {
    color: theme.mutedText,
    fontWeight: "600",
    fontSize: 13,
  },
  chipTextActive: {
    color: theme.text,
  },
  rowGap: {
    gap: 8,
  },
  historyCard: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(39,39,42,0.6)",
    gap: 8,
  },
  historyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "800",
    color: theme.text,
    overflow: "hidden",
  },
  presentPill: {
    backgroundColor: "rgba(34,197,94,0.8)",
  },
  absentPill: {
    backgroundColor: "rgba(239,68,68,0.8)",
  },
  historyActions: {
    flexDirection: "row",
    gap: 8,
  },
  chart: {
    borderRadius: 16,
    marginTop: 12,
  },
  courseStatRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  percentText: {
    color: theme.success,
    fontWeight: "800",
    fontSize: 16,
  },
  emptyText: {
    color: theme.mutedText,
    fontSize: 14,
    lineHeight: 20,
  },
  tabBar: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: "rgba(9,9,11,0.95)",
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: Platform.select({ ios: 22, android: 12, default: 12 }),
  },
  tabBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  tabText: {
    color: theme.mutedText,
    fontSize: 11,
    fontWeight: "600",
  },
  tabTextActive: {
    color: theme.text,
  },
});
