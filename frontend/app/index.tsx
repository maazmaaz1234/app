import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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

import { GlassCard } from "./components/GlassCard";
import { LoaderSkeleton } from "./components/LoaderSkeleton";
import { PrimaryButton } from "./components/PrimaryButton";
import { TextField } from "./components/TextField";
import { theme } from "./constants/theme";
import {
  approveStudent,
  assignSubjects,
  createAdmin,
  createSemester,
  createSubject,
  forgotPasswordAdmin,
  getAdminInsights,
  getApprovedStudents,
  getCollegeProfile,
  getMe,
  getPendingStudents,
  getSemesters,
  getStudentAttendance,
  getStudentInsights,
  getStudentSubjects,
  getSubjectStudents,
  getSubjects,
  importCsv,
  login,
  markBulkAttendance,
  signUp,
  updateCollegeProfile,
} from "./services/api";
import { AttendanceRecord, CollegeProfile, Semester, StudentInsightGroup, Subject, SubjectInsight, User } from "./types";

type Session = { token: string; user: User };
type AuthMode = "login" | "signup";
type AdminTab = "home" | "manage" | "insights" | "settings" | "developer";
type StudentTab = "home" | "history" | "insights" | "settings" | "developer";

const SESSION_KEY = "svam_session";
const LOGO_ASSET = require("../assets/images/shree-vedha-logo.png");

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [profile, setProfile] = useState<CollegeProfile | null>(null);

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

  const handleLogin = useCallback(
    async (phone_number: string, password: string) => {
      setAuthBusy(true);
      setAuthMessage("");
      try {
        const result = await login({ phone_number, password });
        await persistSession({ token: result.access_token, user: result.user });
        setAuthMessage(result.message);
      } catch (error) {
        setAuthMessage(error instanceof Error ? error.message : "Login failed");
      } finally {
        setAuthBusy(false);
      }
    },
    [persistSession]
  );

  const handleSignup = useCallback(
    async (payload: { name: string; phone_number: string; password: string; role: "admin" | "student" }) => {
      setAuthBusy(true);
      setAuthMessage("");
      try {
        const result = await signUp(payload);
        await persistSession({ token: result.access_token, user: result.user });
        setAuthMessage(result.message);
      } catch (error) {
        setAuthMessage(error instanceof Error ? error.message : "Signup failed");
      } finally {
        setAuthBusy(false);
      }
    },
    [persistSession]
  );

  const handleResetAdminPassword = useCallback(async (phone_number: string, new_password: string) => {
    setAuthBusy(true);
    setAuthMessage("");
    try {
      const result = await forgotPasswordAdmin({ phone_number, new_password });
      setAuthMessage(result.message);
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Password reset failed");
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await persistSession(null);
  }, [persistSession]);

  const refreshUser = useCallback(async () => {
    if (!session) return;
    try {
      const user = await getMe(session.token);
      await persistSession({ ...session, user });
    } catch {
      await handleLogout();
    }
  }, [handleLogout, persistSession, session]);

  if (bootLoading) {
    return (
      <SafeAreaView style={styles.loaderScreen}>
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
        onResetAdminPassword={handleResetAdminPassword}
      />
    );
  }

  if (session.user.role === "student" && !session.user.approved) {
    return <PendingApproval onLogout={handleLogout} onRefresh={refreshUser} />;
  }

  if (session.user.role === "admin") {
    return (
      <AdminApp
        token={session.token}
        user={session.user}
        profile={profile}
        onLogout={handleLogout}
        onProfileUpdated={setProfile}
      />
    );
  }

  return <StudentApp token={session.token} user={session.user} profile={profile} onLogout={handleLogout} />;
}

function AuthScreen({
  busy,
  message,
  onLogin,
  onSignup,
  onResetAdminPassword,
}: {
  busy: boolean;
  message: string;
  onLogin: (phone_number: string, password: string) => Promise<void>;
  onSignup: (payload: { name: string; phone_number: string; password: string; role: "admin" | "student" }) => Promise<void>;
  onResetAdminPassword: (phone_number: string, new_password: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [role, setRole] = useState<"admin" | "student">("student");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [forgotPhone, setForgotPhone] = useState("");
  const [forgotPassword, setForgotPassword] = useState("");

  const disableSubmit = useMemo(() => {
    if (mode === "signup") {
      return !name.trim() || !phone.trim() || !password.trim();
    }
    return !phone.trim() || !password.trim();
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
            <TextField label="Password" value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />

            {mode === "login" ? (
              <Pressable testID="forgot-password-toggle" onPress={() => setShowForgot((prev) => !prev)}>
                <Text style={styles.linkText}>Forgot admin password?</Text>
              </Pressable>
            ) : null}

            {showForgot ? (
              <GlassCard style={styles.forgotCard}>
                <TextField
                  label="Admin Phone"
                  value={forgotPhone}
                  onChangeText={setForgotPhone}
                  placeholder="+91XXXXXXXXXX"
                  keyboardType="phone-pad"
                />
                <TextField
                  label="New Password"
                  value={forgotPassword}
                  onChangeText={setForgotPassword}
                  placeholder="New password"
                  secureTextEntry
                />
                <PrimaryButton
                  title="Reset Admin Password"
                  icon="key-change"
                  disabled={!forgotPhone.trim() || !forgotPassword.trim()}
                  loading={busy}
                  onPress={() => onResetAdminPassword(forgotPhone.trim(), forgotPassword.trim())}
                />
              </GlassCard>
            ) : null}

            {message ? <Text style={styles.messageText}>{message}</Text> : null}

            <PrimaryButton
              testID="auth-submit"
              title={mode === "login" ? "Login" : "Create Account"}
              icon="login"
              disabled={disableSubmit}
              loading={busy}
              onPress={() => {
                if (mode === "login") {
                  onLogin(phone.trim(), password.trim());
                } else {
                  onSignup({
                    name: name.trim(),
                    phone_number: phone.trim(),
                    password: password.trim(),
                    role,
                  });
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
          <Text style={styles.smallText}>Your student account will unlock after admin approval.</Text>
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
}: {
  token: string;
  user: User;
  profile: CollegeProfile | null;
  onLogout: () => Promise<void>;
  onProfileUpdated: (profile: CollegeProfile) => void;
}) {
  const [tab, setTab] = useState<AdminTab>("home");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const [students, setStudents] = useState<User[]>([]);
  const [pendingStudents, setPendingStudents] = useState<User[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [insights, setInsights] = useState<StudentInsightGroup[]>([]);

  const [semesterName, setSemesterName] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [subjectCode, setSubjectCode] = useState("");
  const [subjectSemester, setSubjectSemester] = useState("");
  const [selectedStudent, setSelectedStudent] = useState("");
  const [selectedAssignSubjects, setSelectedAssignSubjects] = useState<string[]>([]);

  const [bulkSubject, setBulkSubject] = useState("");
  const [bulkDate, setBulkDate] = useState(today());
  const [bulkStudents, setBulkStudents] = useState<User[]>([]);
  const [presentStudents, setPresentStudents] = useState<string[]>([]);

  const [csvText, setCsvText] = useState("");
  const [collegeName, setCollegeName] = useState(profile?.college_name || "Shree Vedha College");
  const [adminName, setAdminName] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const refreshAll = useCallback(async () => {
    setBusy(true);
    try {
      const [pending, approved, sems, subjs, insightResp, profileResp] = await Promise.all([
        getPendingStudents(token),
        getApprovedStudents(token),
        getSemesters(token),
        getSubjects(token),
        getAdminInsights(token),
        getCollegeProfile(),
      ]);
      setPendingStudents(pending);
      setStudents(approved);
      setSemesters(sems);
      setSubjects(subjs);
      setInsights(insightResp.insights);
      setCollegeName(profileResp.college_name);
      onProfileUpdated(profileResp);
      if (!subjectSemester && sems[0]?.semester_id) setSubjectSemester(sems[0].semester_id);
      if (!selectedStudent && approved[0]?.user_id) setSelectedStudent(approved[0].user_id);
      if (!bulkSubject && subjs[0]?.subject_id) setBulkSubject(subjs[0].subject_id);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load admin data");
    } finally {
      setBusy(false);
    }
  }, [bulkSubject, onProfileUpdated, selectedStudent, subjectSemester, token]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const loadSubjectStudents = async () => {
      if (!bulkSubject) {
        setBulkStudents([]);
        setPresentStudents([]);
        return;
      }
      try {
        const result = await getSubjectStudents(token, bulkSubject);
        setBulkStudents(result);
        setPresentStudents([]);
      } catch {
        setBulkStudents([]);
      }
    };
    loadSubjectStudents();
  }, [bulkSubject, token]);

  const togglePresent = (studentId: string) => {
    setPresentStudents((previous) =>
      previous.includes(studentId) ? previous.filter((item) => item !== studentId) : [...previous, studentId]
    );
  };

  const logoSource = profile?.logo_base64 ? { uri: profile.logo_base64 } : LOGO_ASSET;
  const tabs: { key: AdminTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "manage", label: "Manage", icon: "create-outline" },
    { key: "insights", label: "Insights", icon: "analytics-outline" },
    { key: "settings", label: "Settings", icon: "settings-outline" },
    { key: "developer", label: "Developer", icon: "code-slash-outline" },
  ];

  return (
    <SafeAreaView style={styles.safeRoot}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerTitle}>{profile?.college_name || "Shree Vedha College"}</Text>
          <Text style={styles.headerSubtitle}>Admin: {user.name}</Text>
        </View>
        <Pressable testID="refresh-admin" style={styles.refreshBtn} onPress={refreshAll}>
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
                  <Text style={styles.smallText}>Attendance Management Dashboard</Text>
                </View>
              </View>
            </GlassCard>

            <View style={styles.statGrid}>
              <StatCard label="Pending Students" value={`${pendingStudents.length}`} />
              <StatCard label="Students" value={`${students.length}`} />
              <StatCard label="Subjects" value={`${subjects.length}`} />
            </View>

            <GlassCard>
              <Text style={styles.sectionTitle}>Pending Approvals</Text>
              {busy && pendingStudents.length === 0 ? <LoaderSkeleton /> : null}
              {!pendingStudents.length && !busy ? <Text style={styles.smallText}>No pending students.</Text> : null}
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
                <Text style={styles.sectionTitle}>Create Semester</Text>
                <TextField label="Semester Name" value={semesterName} onChangeText={setSemesterName} placeholder="BCA 1st Sem" />
                <PrimaryButton
                  title="Add Semester"
                  icon="plus"
                  disabled={!semesterName.trim()}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await createSemester(token, semesterName.trim());
                      setSemesterName("");
                      await refreshAll();
                      setMessage("Semester created");
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Semester creation failed");
                      setBusy(false);
                    }
                  }}
                />
              </GlassCard>

              <GlassCard>
                <Text style={styles.sectionTitle}>Create Subject</Text>
                <Text style={styles.smallText}>Select semester</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rowWrap}>
                  {semesters.map((semester) => (
                    <Chip
                      key={semester.semester_id}
                      title={semester.name}
                      active={subjectSemester === semester.semester_id}
                      onPress={() => setSubjectSemester(semester.semester_id)}
                    />
                  ))}
                </ScrollView>
                <TextField label="Subject Name" value={subjectName} onChangeText={setSubjectName} placeholder="English" />
                <TextField label="Subject Code" value={subjectCode} onChangeText={setSubjectCode} placeholder="ENG01" />
                <PrimaryButton
                  title="Add Subject"
                  icon="book-plus"
                  disabled={!subjectSemester || !subjectName.trim() || !subjectCode.trim()}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await createSubject(token, {
                        semester_id: subjectSemester,
                        name: subjectName.trim(),
                        code: subjectCode.trim(),
                      });
                      setSubjectName("");
                      setSubjectCode("");
                      await refreshAll();
                      setMessage("Subject created");
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Subject creation failed");
                      setBusy(false);
                    }
                  }}
                />
              </GlassCard>

              <GlassCard>
                <Text style={styles.sectionTitle}>Assign Subjects to Student</Text>
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

                <Text style={styles.smallText}>Select one or more subjects</Text>
                <View style={styles.wrapContainer}>
                  {subjects.map((subject) => {
                    const active = selectedAssignSubjects.includes(subject.subject_id);
                    return (
                      <Chip
                        key={subject.subject_id}
                        title={subject.code}
                        active={active}
                        onPress={() => {
                          setSelectedAssignSubjects((previous) =>
                            previous.includes(subject.subject_id)
                              ? previous.filter((item) => item !== subject.subject_id)
                              : [...previous, subject.subject_id]
                          );
                        }}
                      />
                    );
                  })}
                </View>

                <PrimaryButton
                  title="Assign Subjects"
                  icon="account-check"
                  disabled={!selectedStudent || !selectedAssignSubjects.length}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await assignSubjects(token, {
                        student_id: selectedStudent,
                        subject_ids: selectedAssignSubjects,
                      });
                      setSelectedAssignSubjects([]);
                      setMessage("Subjects assigned");
                      setBusy(false);
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Assignment failed");
                      setBusy(false);
                    }
                  }}
                />
              </GlassCard>

              <GlassCard>
                <Text style={styles.sectionTitle}>Bulk Attendance by Subject</Text>
                <Text style={styles.smallText}>Select subject</Text>
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

                <TextField label="Date (YYYY-MM-DD)" value={bulkDate} onChangeText={setBulkDate} placeholder="2026-03-20" />

                <Text style={styles.smallText}>Tap students who are present. Others become absent.</Text>
                <View style={styles.listWrap}>
                  {bulkStudents.map((student) => {
                    const active = presentStudents.includes(student.user_id);
                    return (
                      <Pressable
                        key={student.user_id}
                        testID={`bulk-student-${student.user_id}`}
                        style={[styles.selectRow, active && styles.selectRowActive]}
                        onPress={() => togglePresent(student.user_id)}
                      >
                        <View style={styles.selectLabelWrap}>
                          <Text style={styles.rowTitle}>{student.name}</Text>
                          <Text style={styles.smallText}>{student.phone_number}</Text>
                        </View>
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
                  disabled={!bulkSubject || !bulkDate.trim() || !bulkStudents.length}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await markBulkAttendance(token, {
                        subject_id: bulkSubject,
                        date: bulkDate.trim(),
                        present_student_ids: presentStudents,
                      });
                      await refreshAll();
                      setMessage("Bulk attendance saved");
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Bulk attendance failed");
                      setBusy(false);
                    }
                  }}
                />
              </GlassCard>

              <GlassCard>
                <Text style={styles.sectionTitle}>CSV Import (Students + Subjects)</Text>
                <Text style={styles.smallText}>Columns: student_name,phone_number,password,semester,subjects</Text>
                <Text style={styles.smallText}>Subjects format: English|Computer Science|Maths</Text>
                <TextField
                  label="Paste CSV Text"
                  value={csvText}
                  onChangeText={setCsvText}
                  placeholder="student_name,phone_number,password,semester,subjects"
                  multiline
                  style={styles.csvInput}
                />
                <PrimaryButton
                  title="Import CSV"
                  icon="file-upload"
                  disabled={!csvText.trim()}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await importCsv(token, csvText);
                      setCsvText("");
                      await refreshAll();
                      setMessage("CSV imported successfully");
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "CSV import failed");
                      setBusy(false);
                    }
                  }}
                />
              </GlassCard>
            </ScrollView>
          </KeyboardAvoidingView>
        ) : null}

        {tab === "insights" ? (
          <ScrollView contentContainerStyle={styles.screenBody}>
            <GlassCard>
              <Text style={styles.sectionTitle}>Student-Subject Insights</Text>
              {!insights.length ? <Text style={styles.smallText}>No insight data yet.</Text> : null}
              <View style={styles.listWrap}>
                {insights.map((entry) => (
                  <GlassCard key={`${entry.student_id}-${entry.semester_id}`} style={styles.innerCard}>
                    <Text style={styles.rowTitle}>{entry.semester_name}</Text>
                    <Text style={styles.smallText}>{entry.student_name}</Text>
                    {entry.subjects.length === 0 ? <Text style={styles.smallText}>No subjects assigned.</Text> : null}
                    {entry.subjects.map((subject) => (
                      <View key={subject.subject_id} style={styles.percentRow}>
                        <Text style={styles.smallText}>{subject.subject_name}</Text>
                        <Text style={styles.percentText}>{subject.percentage.toFixed(1)}%</Text>
                      </View>
                    ))}
                  </GlassCard>
                ))}
              </View>
            </GlassCard>
          </ScrollView>
        ) : null}

        {tab === "settings" ? (
          <ScrollView contentContainerStyle={styles.screenBody}>
            <GlassCard>
              <Text style={styles.sectionTitle}>College Name</Text>
              <TextField label="College Name" value={collegeName} onChangeText={setCollegeName} placeholder="Shree Vedha College" />
              <PrimaryButton
                title="Update College Name"
                icon="pencil"
                disabled={!collegeName.trim()}
                onPress={async () => {
                  setBusy(true);
                  try {
                    const updated = await updateCollegeProfile(token, { college_name: collegeName.trim() });
                    onProfileUpdated(updated);
                    setMessage("College name updated");
                    setBusy(false);
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Update failed");
                    setBusy(false);
                  }
                }}
              />
            </GlassCard>

            <GlassCard>
              <Text style={styles.sectionTitle}>Create Another Admin</Text>
              <TextField label="Admin Name" value={adminName} onChangeText={setAdminName} placeholder="Admin Name" />
              <TextField
                label="Admin Phone"
                value={adminPhone}
                onChangeText={setAdminPhone}
                placeholder="+91XXXXXXXXXX"
                keyboardType="phone-pad"
              />
              <TextField label="Password" value={adminPassword} onChangeText={setAdminPassword} placeholder="Password" secureTextEntry />
              <PrimaryButton
                title="Create Admin"
                icon="account-plus"
                disabled={!adminName.trim() || !adminPhone.trim() || !adminPassword.trim()}
                onPress={async () => {
                  setBusy(true);
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
                    setBusy(false);
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Admin creation failed");
                    setBusy(false);
                  }
                }}
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
}: {
  token: string;
  user: User;
  profile: CollegeProfile | null;
  onLogout: () => Promise<void>;
}) {
  const [tab, setTab] = useState<StudentTab>("home");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [insights, setInsights] = useState<SubjectInsight[]>([]);
  const [subjectFilter, setSubjectFilter] = useState("");

  const refreshAll = useCallback(async () => {
    setBusy(true);
    try {
      const [subjectData, attendanceData, insightData] = await Promise.all([
        getStudentSubjects(token),
        getStudentAttendance(token),
        getStudentInsights(token),
      ]);
      setSubjects(subjectData);
      setAttendance(attendanceData);
      setInsights(insightData);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load student data");
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const logoSource = profile?.logo_base64 ? { uri: profile.logo_base64 } : LOGO_ASSET;
  const tabs: { key: StudentTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "home", label: "Home", icon: "home-outline" },
    { key: "history", label: "History", icon: "calendar-outline" },
    { key: "insights", label: "Insights", icon: "stats-chart-outline" },
    { key: "settings", label: "Settings", icon: "settings-outline" },
    { key: "developer", label: "Developer", icon: "code-slash-outline" },
  ];

  const filteredAttendance = attendance.filter((item) => (subjectFilter ? item.subject_id === subjectFilter : true));

  return (
    <SafeAreaView style={styles.safeRoot}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerTitle}>{profile?.college_name || "Shree Vedha College"}</Text>
          <Text style={styles.headerSubtitle}>{user.name}</Text>
        </View>
        <Pressable testID="refresh-student" style={styles.refreshBtn} onPress={refreshAll}>
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
                  <Text style={styles.smallText}>Student Attendance Overview</Text>
                </View>
              </View>
            </GlassCard>

            <GlassCard>
              <Text style={styles.sectionTitle}>Subject Tracking</Text>
              {busy && !insights.length ? <LoaderSkeleton /> : null}
              {!insights.length && !busy ? <Text style={styles.smallText}>No attendance tracked yet.</Text> : null}
              <View style={styles.listWrap}>
                {insights.map((item) => (
                  <View key={item.subject_id} style={styles.percentRow}>
                    <Text style={styles.rowTitle}>{item.subject_name}</Text>
                    <Text style={styles.percentText}>{item.percentage.toFixed(1)}%</Text>
                  </View>
                ))}
              </View>
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
              {!filteredAttendance.length ? <Text style={styles.smallText}>No attendance records.</Text> : null}
              <View style={styles.listWrap}>
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
              </View>
            </GlassCard>
          </ScrollView>
        ) : null}

        {tab === "insights" ? (
          <ScrollView contentContainerStyle={styles.screenBody}>
            <GlassCard>
              <Text style={styles.sectionTitle}>Subject Percentages</Text>
              {!insights.length ? <Text style={styles.smallText}>No insights available yet.</Text> : null}
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

        {tab === "settings" ? (
          <ScrollView contentContainerStyle={styles.screenBody}>
            <GlassCard>
              <Text style={styles.sectionTitle}>Account</Text>
              <Text style={styles.smallText}>Phone: {user.phone_number}</Text>
              <Text style={styles.smallText}>Role: Student</Text>
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <GlassCard style={styles.statCard}>
      <Text style={styles.smallText}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </GlassCard>
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
        <Pressable key={item.key} testID={`tab-${item.key}`} style={styles.tabBtn} onPress={() => onPress(item.key)}>
          <Ionicons name={item.icon} size={20} color={activeKey === item.key ? theme.text : theme.mutedText} />
          <Text style={[styles.tabText, activeKey === item.key && styles.tabTextActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Chip({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={`chip-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{title}</Text>
    </Pressable>
  );
}

function RoleChip({ title, active, onPress }: { title: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={`role-${title.toLowerCase()}`}
      style={[styles.roleChip, active && styles.roleChipActive]}
      onPress={onPress}
    >
      <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeRoot: {
    flex: 1,
    backgroundColor: theme.background,
  },
  loaderScreen: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.background,
  },
  flex1: {
    flex: 1,
  },
  authContainer: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 28,
    justifyContent: "center",
    gap: 16,
  },
  authLogo: {
    width: 110,
    height: 110,
    alignSelf: "center",
    backgroundColor: "#ffffff",
    borderRadius: 16,
  },
  authTitle: {
    color: theme.text,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    textAlign: "center",
  },
  authCard: {
    gap: 12,
  },
  modeRow: {
    flexDirection: "row",
    backgroundColor: "rgba(27,39,84,0.8)",
    borderRadius: 14,
    padding: 4,
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
  },
  modeBtnActive: {
    backgroundColor: theme.primary,
  },
  modeText: {
    color: theme.mutedText,
    fontSize: 14,
    fontWeight: "700",
  },
  modeTextActive: {
    color: theme.text,
  },
  rowWrap: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    paddingVertical: 4,
  },
  roleChip: {
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: "rgba(27,39,84,0.7)",
    paddingHorizontal: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  roleChipActive: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },
  roleChipText: {
    color: theme.mutedText,
    fontWeight: "600",
  },
  roleChipTextActive: {
    color: theme.text,
  },
  forgotCard: {
    padding: 12,
    gap: 10,
  },
  linkText: {
    color: theme.warning,
    fontSize: 13,
    fontWeight: "700",
  },
  messageText: {
    color: theme.warning,
    fontSize: 13,
    fontWeight: "700",
    paddingHorizontal: 20,
  },
  centerWrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  pendingCard: {
    alignItems: "center",
    gap: 10,
  },
  pendingLogo: {
    width: 84,
    height: 84,
    backgroundColor: "#ffffff",
    borderRadius: 12,
  },
  headerRow: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: "800",
    maxWidth: 260,
  },
  headerSubtitle: {
    color: theme.mutedText,
    marginTop: 4,
  },
  refreshBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.secondary,
  },
  screenBody: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 14,
  },
  logoTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  heroLogo: {
    width: 68,
    height: 68,
    backgroundColor: "#ffffff",
    borderRadius: 12,
  },
  sectionTitle: {
    color: theme.text,
    fontSize: 22,
    fontWeight: "700",
  },
  smallText: {
    color: theme.mutedText,
    fontSize: 13,
    lineHeight: 18,
  },
  statGrid: {
    gap: 10,
  },
  statCard: {
    minHeight: 82,
    justifyContent: "center",
    gap: 6,
  },
  statValue: {
    color: theme.text,
    fontSize: 26,
    fontWeight: "800",
  },
  listWrap: {
    gap: 10,
  },
  rowCard: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(27,39,84,0.5)",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  rowTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: "700",
  },
  chip: {
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.secondary,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  chipActive: {
    borderColor: theme.primary,
    backgroundColor: theme.primary,
  },
  chipText: {
    color: theme.mutedText,
    fontSize: 13,
    fontWeight: "700",
  },
  chipTextActive: {
    color: theme.text,
  },
  wrapContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  selectRow: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(27,39,84,0.45)",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  selectRowActive: {
    borderColor: theme.success,
    backgroundColor: "rgba(34,197,94,0.12)",
  },
  selectLabelWrap: {
    flex: 1,
  },
  csvInput: {
    minHeight: 140,
    textAlignVertical: "top",
    paddingTop: 12,
  },
  innerCard: {
    gap: 8,
    padding: 12,
  },
  percentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingVertical: 8,
  },
  percentDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingVertical: 10,
  },
  percentText: {
    color: theme.success,
    fontSize: 18,
    fontWeight: "800",
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    fontSize: 11,
    fontWeight: "800",
    color: theme.text,
  },
  presentBadge: {
    backgroundColor: "rgba(34,197,94,0.8)",
  },
  absentBadge: {
    backgroundColor: "rgba(239,68,68,0.8)",
  },
  tabBar: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: "rgba(7,11,26,0.95)",
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: Platform.select({ ios: 20, android: 10, default: 10 }),
  },
  tabBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  tabText: {
    color: theme.mutedText,
    fontSize: 11,
    fontWeight: "700",
  },
  tabTextActive: {
    color: theme.text,
  },
});
