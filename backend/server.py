import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Literal, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
db_name = os.environ["DB_NAME"]
jwt_secret = os.environ["JWT_SECRET"]

client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

COLLEGE_ID = "shree-vedha"
DEFAULT_COLLEGE_NAME = "Shree Vedha College"
PHONE_REGEX = re.compile(r"^\+?\d{10,15}$")

app = FastAPI(title="Shree Vedha Attendance API")
api_router = APIRouter(prefix="/api")


class CollegeProfile(BaseModel):
    college_id: str
    college_name: str
    logo_base64: Optional[str] = ""
    updated_at: str


class CollegeProfileUpdate(BaseModel):
    college_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    logo_base64: Optional[str] = None


class UserPublic(BaseModel):
    user_id: str
    name: str
    phone_number: str
    role: Literal["admin", "student"]
    approved: bool
    course_id: Optional[str] = None
    profile_image_base64: Optional[str] = ""
    created_at: str


class AuthResponse(BaseModel):
    access_token: str
    message: str
    user: UserPublic


class SignUpInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone_number: str
    password: str = Field(min_length=6, max_length=80)
    role: Literal["admin", "student"]
    course_id: Optional[str] = None


class LoginInput(BaseModel):
    phone_number: str
    password: str = Field(min_length=6, max_length=80)


class ForgotPasswordAdminInput(BaseModel):
    phone_number: str
    new_password: str = Field(min_length=6, max_length=80)


class CreateAdminInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone_number: str
    password: str = Field(min_length=6, max_length=80)


class SemesterInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)


class CourseOutput(BaseModel):
    course_id: str
    name: str
    created_at: str


class SubjectInput(BaseModel):
    course_id: str
    name: str = Field(min_length=2, max_length=80)
    code: str = Field(min_length=1, max_length=30)


class SubjectOutput(BaseModel):
    subject_id: str
    course_id: str
    name: str
    code: str
    created_at: str


class AssignSubjectsInput(BaseModel):
    subject_ids: List[str]


class BulkAttendanceInput(BaseModel):
    subject_id: str
    date: str
    present_student_ids: List[str]


class AttendanceRecord(BaseModel):
    record_id: str
    subject_id: str
    subject_name: str
    student_id: str
    student_name: str
    date: str
    status: Literal["present", "absent"]
    marked_by: str
    created_at: str
    updated_at: Optional[str] = None


class SubjectPercent(BaseModel):
    subject_id: str
    subject_name: str
    present: int
    total: int
    percentage: float


class StudentInsight(BaseModel):
    course_id: str
    course_name: str
    student_id: str
    student_name: str
    profile_image_base64: Optional[str] = ""
    subjects: List[SubjectPercent]


class AdminInsightsResponse(BaseModel):
    insights: List[StudentInsight]


class AdminPasswordInput(BaseModel):
    admin_password: str


class StudentPasswordChangeInput(BaseModel):
    admin_password: str
    new_password: str = Field(min_length=6, max_length=80)


class StudentSelfPasswordInput(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=80)


class StudentProfileUpdateInput(BaseModel):
    name: Optional[str] = None
    course_id: Optional[str] = None
    profile_image_base64: Optional[str] = None


class AttendanceUpdateInput(BaseModel):
    status: Literal["present", "absent"]


class NotificationOutput(BaseModel):
    notification_id: str
    message: str
    event_type: str
    student_id: Optional[str] = None
    created_at: str
    read: bool


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_text(value: str) -> str:
    return " ".join(value.strip().split())


def normalize_phone(value: str) -> str:
    phone = value.replace(" ", "").strip()
    if not PHONE_REGEX.match(phone):
        raise HTTPException(status_code=400, detail="Enter valid phone number")
    return phone


def hash_password(password: str) -> str:
    return password_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_context.verify(password, hashed_password)


def create_token(user_id: str, role: str) -> str:
    expiry = datetime.now(timezone.utc) + timedelta(hours=72)
    payload = {"sub": user_id, "role": role, "exp": expiry}
    return jwt.encode(payload, jwt_secret, algorithm="HS256")


def user_public_doc(user_doc: Dict) -> UserPublic:
    return UserPublic(
        user_id=user_doc["user_id"],
        name=user_doc["name"],
        phone_number=user_doc.get("phone_number", ""),
        role=user_doc["role"],
        approved=user_doc["approved"],
        course_id=user_doc.get("course_id"),
        profile_image_base64=user_doc.get("profile_image_base64", ""),
        created_at=user_doc["created_at"],
    )


async def fetch_user_by_id(user_id: str) -> Optional[Dict]:
    return await db.users.find_one({"user_id": user_id}, {"_id": 0})


async def current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> Dict:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, jwt_secret, algorithms=["HS256"])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError as err:
        raise HTTPException(status_code=401, detail="Invalid token") from err

    user = await fetch_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def admin_user(user: Dict = Depends(current_user)) -> Dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def approved_student_user(user: Dict = Depends(current_user)) -> Dict:
    if user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Student access required")
    if not user.get("approved", False):
        raise HTTPException(status_code=403, detail="Approval pending")
    return user


async def ensure_college_profile() -> None:
    existing = await db.college_profile.find_one({"college_id": COLLEGE_ID}, {"_id": 0})
    if existing:
        return
    await db.college_profile.insert_one(
        {
            "college_id": COLLEGE_ID,
            "college_name": DEFAULT_COLLEGE_NAME,
            "logo_base64": "",
            "updated_at": utc_now_iso(),
        }
    )


async def push_notification(message: str, event_type: str, student_id: Optional[str] = None):
    await db.notifications.insert_one(
        {
            "notification_id": str(uuid.uuid4()),
            "message": message,
            "event_type": event_type,
            "student_id": student_id,
            "created_at": utc_now_iso(),
            "read": False,
        }
    )


async def verify_admin_password(user: Dict, password: str):
    if not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect admin password")


def subject_code_from_name(name: str, index: int) -> str:
    initials = "".join([part[0] for part in name.split() if part]).upper()
    initials = initials[:4] if initials else "SUBJ"
    return f"{initials}{index:02d}"


@api_router.get("/")
async def root():
    return {"message": "Shree Vedha Attendance API running"}


@api_router.get("/college/profile", response_model=CollegeProfile)
async def get_college_profile():
    await ensure_college_profile()
    profile = await db.college_profile.find_one({"college_id": COLLEGE_ID}, {"_id": 0})
    return CollegeProfile(**profile)


@api_router.post("/auth/signup", response_model=AuthResponse)
async def signup(input_data: SignUpInput):
    phone = normalize_phone(input_data.phone_number)
    existing = await db.users.find_one({"phone_number": phone}, {"_id": 0, "user_id": 1})
    if existing:
        raise HTTPException(status_code=400, detail="Phone number already registered")

    selected_course_id = input_data.course_id
    if input_data.role == "student" and selected_course_id:
        exists_course = await db.courses.find_one({"course_id": selected_course_id}, {"_id": 0, "course_id": 1})
        if not exists_course:
            raise HTTPException(status_code=400, detail="Course not found")

    user_doc = {
        "user_id": str(uuid.uuid4()),
        "name": normalize_text(input_data.name),
        "phone_number": phone,
        "password_hash": hash_password(input_data.password),
        "role": input_data.role,
        "approved": input_data.role == "admin",
        "course_id": selected_course_id,
        "profile_image_base64": "",
        "college_id": COLLEGE_ID,
        "created_at": utc_now_iso(),
    }
    await db.users.insert_one(user_doc.copy())

    token = create_token(user_doc["user_id"], user_doc["role"])
    message = "Account created" if user_doc["approved"] else "Signup done. Waiting for admin approval"
    return AuthResponse(access_token=token, message=message, user=user_public_doc(user_doc))


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(input_data: LoginInput):
    phone = normalize_phone(input_data.phone_number)
    user = await db.users.find_one({"phone_number": phone}, {"_id": 0})
    if not user or not verify_password(input_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid phone or password")

    token = create_token(user["user_id"], user["role"])
    message = "Login successful" if user["approved"] else "Login successful. Approval pending"
    return AuthResponse(access_token=token, message=message, user=user_public_doc(user))


@api_router.post("/auth/forgot-password-admin")
async def forgot_password_admin(input_data: ForgotPasswordAdminInput):
    phone = normalize_phone(input_data.phone_number)
    result = await db.users.update_one(
        {"phone_number": phone, "role": "admin"},
        {"$set": {"password_hash": hash_password(input_data.new_password)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Admin not found")
    return {"message": "Admin password reset successful"}


@api_router.get("/auth/me", response_model=UserPublic)
async def me(user: Dict = Depends(current_user)):
    return user_public_doc(user)


@api_router.post("/admin/create-admin", response_model=UserPublic)
async def create_admin(input_data: CreateAdminInput, _: Dict = Depends(admin_user)):
    phone = normalize_phone(input_data.phone_number)
    existing = await db.users.find_one({"phone_number": phone}, {"_id": 0, "user_id": 1})
    if existing:
        raise HTTPException(status_code=400, detail="Phone number already used")

    admin_doc = {
        "user_id": str(uuid.uuid4()),
        "name": normalize_text(input_data.name),
        "phone_number": phone,
        "password_hash": hash_password(input_data.password),
        "role": "admin",
        "approved": True,
        "course_id": None,
        "profile_image_base64": "",
        "college_id": COLLEGE_ID,
        "created_at": utc_now_iso(),
    }
    await db.users.insert_one(admin_doc.copy())
    return user_public_doc(admin_doc)


@api_router.patch("/admin/college-profile", response_model=CollegeProfile)
async def update_college_profile(input_data: CollegeProfileUpdate, _: Dict = Depends(admin_user)):
    await ensure_college_profile()
    update_doc = {}
    if input_data.college_name is not None:
        update_doc["college_name"] = normalize_text(input_data.college_name)
    if input_data.logo_base64 is not None:
        update_doc["logo_base64"] = input_data.logo_base64
    if not update_doc:
        raise HTTPException(status_code=400, detail="No changes provided")

    update_doc["updated_at"] = utc_now_iso()
    await db.college_profile.update_one({"college_id": COLLEGE_ID}, {"$set": update_doc})
    profile = await db.college_profile.find_one({"college_id": COLLEGE_ID}, {"_id": 0})
    return CollegeProfile(**profile)


@api_router.get("/admin/pending-students", response_model=List[UserPublic])
async def pending_students(_: Dict = Depends(admin_user)):
    students = await db.users.find(
        {"role": "student", "approved": False, "phone_number": {"$exists": True}},
        {"_id": 0, "password_hash": 0},
    ).to_list(1000)
    return [user_public_doc(item) for item in students]


@api_router.post("/admin/approve-student/{student_id}")
async def approve_student(student_id: str, _: Dict = Depends(admin_user)):
    result = await db.users.update_one({"user_id": student_id, "role": "student"}, {"$set": {"approved": True}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Student not found")
    return {"message": "Student approved"}


@api_router.get("/admin/students", response_model=List[UserPublic])
async def admin_students(_: Dict = Depends(admin_user)):
    students = await db.users.find(
        {"role": "student", "approved": True, "phone_number": {"$exists": True}},
        {"_id": 0, "password_hash": 0},
    ).to_list(2000)
    students.sort(key=lambda item: item["name"])
    return [user_public_doc(item) for item in students]


@api_router.post("/admin/courses", response_model=CourseOutput)
async def create_course(input_data: SemesterInput, user: Dict = Depends(admin_user)):
    name = normalize_text(input_data.name)
    existing = await db.courses.find_one({"name": name}, {"_id": 0, "course_id": 1})
    if existing:
        raise HTTPException(status_code=400, detail="Course already exists")

    doc = {
        "course_id": str(uuid.uuid4()),
        "name": name,
        "created_by": user["user_id"],
        "created_at": utc_now_iso(),
    }
    await db.courses.insert_one(doc.copy())
    return CourseOutput(**{k: doc[k] for k in ["course_id", "name", "created_at"]})


@api_router.get("/admin/courses", response_model=List[CourseOutput])
async def get_courses(_: Dict = Depends(admin_user)):
    courses = await db.courses.find({}, {"_id": 0, "course_id": 1, "name": 1, "created_at": 1}).to_list(1000)
    courses.sort(key=lambda item: item["created_at"], reverse=True)
    return courses


@api_router.delete("/admin/courses/{course_id}")
async def delete_course(course_id: str, input_data: AdminPasswordInput, user: Dict = Depends(admin_user)):
    await verify_admin_password(user, input_data.admin_password)
    result = await db.courses.delete_one({"course_id": course_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Course not found")

    subject_docs = await db.subjects.find({"course_id": course_id}, {"_id": 0, "subject_id": 1}).to_list(1000)
    subject_ids = [item["subject_id"] for item in subject_docs]

    if subject_ids:
        await db.subjects.delete_many({"subject_id": {"$in": subject_ids}})
        await db.attendance.delete_many({"subject_id": {"$in": subject_ids}})
        await db.student_subject_assignments.update_many({}, {"$pull": {"subject_ids": {"$in": subject_ids}}})
    await db.users.update_many({"course_id": course_id, "role": "student"}, {"$set": {"course_id": None}})
    return {"message": "Course deleted"}


@api_router.post("/admin/subjects", response_model=SubjectOutput)
async def create_subject(input_data: SubjectInput, user: Dict = Depends(admin_user)):
    course = await db.courses.find_one({"course_id": input_data.course_id}, {"_id": 0, "course_id": 1})
    if not course:
        raise HTTPException(status_code=400, detail="Course not found")

    name = normalize_text(input_data.name)
    code = normalize_text(input_data.code).upper()
    existing = await db.subjects.find_one(
        {"course_id": input_data.course_id, "$or": [{"name": name}, {"code": code}]},
        {"_id": 0, "subject_id": 1},
    )
    if existing:
        raise HTTPException(status_code=400, detail="Subject already exists")

    doc = {
        "subject_id": str(uuid.uuid4()),
        "course_id": input_data.course_id,
        "name": name,
        "code": code,
        "created_by": user["user_id"],
        "created_at": utc_now_iso(),
    }
    await db.subjects.insert_one(doc.copy())
    return SubjectOutput(**{k: doc[k] for k in ["subject_id", "course_id", "name", "code", "created_at"]})


@api_router.get("/admin/subjects", response_model=List[SubjectOutput])
async def get_subjects(course_id: Optional[str] = Query(default=None), _: Dict = Depends(admin_user)):
    query: Dict[str, str] = {}
    if course_id:
        query["course_id"] = course_id
    subjects = await db.subjects.find(
        query,
        {"_id": 0, "subject_id": 1, "course_id": 1, "name": 1, "code": 1, "created_at": 1},
    ).to_list(2000)
    subjects.sort(key=lambda item: (item["course_id"], item["name"]))
    return subjects


@api_router.delete("/admin/subjects/{subject_id}")
async def delete_subject(subject_id: str, input_data: AdminPasswordInput, user: Dict = Depends(admin_user)):
    await verify_admin_password(user, input_data.admin_password)
    result = await db.subjects.delete_one({"subject_id": subject_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Subject not found")
    await db.attendance.delete_many({"subject_id": subject_id})
    await db.student_subject_assignments.update_many({}, {"$pull": {"subject_ids": subject_id}})
    return {"message": "Subject deleted"}


@api_router.post("/admin/students/{student_id}/assign-subjects")
async def assign_subjects(student_id: str, input_data: AssignSubjectsInput, _: Dict = Depends(admin_user)):
    student = await db.users.find_one(
        {"user_id": student_id, "role": "student", "approved": True},
        {"_id": 0, "user_id": 1},
    )
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    subjects = await db.subjects.find({"subject_id": {"$in": input_data.subject_ids}}, {"_id": 0, "subject_id": 1, "course_id": 1}).to_list(1000)
    if len(subjects) != len(set(input_data.subject_ids)):
        raise HTTPException(status_code=400, detail="One or more subjects invalid")

    course_ids = {item["course_id"] for item in subjects}
    if len(course_ids) > 1:
        raise HTTPException(status_code=400, detail="Assign subjects from one course at a time")
    course_id = next(iter(course_ids)) if course_ids else None
    await db.users.update_one({"user_id": student_id}, {"$set": {"course_id": course_id}})

    await db.student_subject_assignments.update_one(
        {"student_id": student_id},
        {"$set": {"subject_ids": sorted(set(input_data.subject_ids)), "updated_at": utc_now_iso()}},
        upsert=True,
    )
    return {"message": "Subjects assigned"}


@api_router.get("/admin/subject-students", response_model=List[UserPublic])
async def get_subject_students(subject_id: str = Query(...), _: Dict = Depends(admin_user)):
    assignments = await db.student_subject_assignments.find(
        {"subject_ids": subject_id},
        {"_id": 0, "student_id": 1},
    ).to_list(2000)
    student_ids = [item["student_id"] for item in assignments]
    if not student_ids:
        return []

    students = await db.users.find(
        {
            "user_id": {"$in": student_ids},
            "role": "student",
            "approved": True,
            "phone_number": {"$exists": True},
        },
        {"_id": 0, "password_hash": 0},
    ).to_list(2000)
    students.sort(key=lambda item: item["name"])
    return [user_public_doc(item) for item in students]


@api_router.post("/admin/attendance/bulk")
async def mark_bulk_attendance(input_data: BulkAttendanceInput, user: Dict = Depends(admin_user)):
    subject = await db.subjects.find_one({"subject_id": input_data.subject_id}, {"_id": 0, "name": 1})
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    assignments = await db.student_subject_assignments.find(
        {"subject_ids": input_data.subject_id},
        {"_id": 0, "student_id": 1},
    ).to_list(3000)
    assigned_ids = [item["student_id"] for item in assignments]
    if not assigned_ids:
        raise HTTPException(status_code=400, detail="No students assigned to this subject")

    students = await db.users.find(
        {"user_id": {"$in": assigned_ids}, "role": "student", "approved": True},
        {"_id": 0, "user_id": 1, "name": 1},
    ).to_list(3000)
    student_map = {item["user_id"]: item["name"] for item in students}

    now = utc_now_iso()
    present_set = set(input_data.present_student_ids)
    updated_records = 0
    for student_id in assigned_ids:
        if student_id not in student_map:
            continue
        status_value = "present" if student_id in present_set else "absent"
        existing = await db.attendance.find_one(
            {
                "subject_id": input_data.subject_id,
                "student_id": student_id,
                "date": input_data.date,
            },
            {"_id": 0, "record_id": 1},
        )
        if existing:
            await db.attendance.update_one(
                {"record_id": existing["record_id"]},
                {"$set": {"status": status_value, "updated_at": now, "marked_by": user["user_id"]}},
            )
        else:
            doc = {
                "record_id": str(uuid.uuid4()),
                "subject_id": input_data.subject_id,
                "subject_name": subject["name"],
                "student_id": student_id,
                "student_name": student_map[student_id],
                "date": input_data.date,
                "status": status_value,
                "marked_by": user["user_id"],
                "created_at": now,
                "updated_at": None,
            }
            await db.attendance.insert_one(doc.copy())
        updated_records += 1

    return {"message": "Bulk attendance saved", "updated_records": updated_records}


@api_router.get("/admin/attendance", response_model=List[AttendanceRecord])
async def admin_attendance(
    subject_id: Optional[str] = Query(default=None),
    student_id: Optional[str] = Query(default=None),
    _: Dict = Depends(admin_user),
):
    query: Dict[str, str] = {}
    if subject_id:
        query["subject_id"] = subject_id
    if student_id:
        query["student_id"] = student_id
    records = await db.attendance.find(query, {"_id": 0}).to_list(10000)
    records.sort(key=lambda item: (item["date"], item["student_name"]), reverse=True)
    return [AttendanceRecord(**item) for item in records]


@api_router.put("/admin/attendance/{record_id}")
async def update_attendance(record_id: str, input_data: AttendanceUpdateInput, _: Dict = Depends(admin_user)):
    result = await db.attendance.update_one(
        {"record_id": record_id},
        {"$set": {"status": input_data.status, "updated_at": utc_now_iso()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Attendance record not found")
    return {"message": "Attendance updated"}


@api_router.delete("/admin/attendance/{record_id}")
async def delete_attendance(record_id: str, input_data: AdminPasswordInput, user: Dict = Depends(admin_user)):
    await verify_admin_password(user, input_data.admin_password)
    result = await db.attendance.delete_one({"record_id": record_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Attendance record not found")
    return {"message": "Attendance deleted"}


@api_router.patch("/admin/students/{student_id}/profile")
async def admin_update_student_profile(student_id: str, input_data: StudentProfileUpdateInput, _: Dict = Depends(admin_user)):
    updates = {}
    if input_data.name is not None:
        updates["name"] = normalize_text(input_data.name)
    if input_data.course_id is not None:
        if input_data.course_id:
            course = await db.courses.find_one({"course_id": input_data.course_id}, {"_id": 0, "course_id": 1})
            if not course:
                raise HTTPException(status_code=404, detail="Course not found")
            updates["course_id"] = input_data.course_id
        else:
            updates["course_id"] = None
    if input_data.profile_image_base64 is not None:
        updates["profile_image_base64"] = input_data.profile_image_base64

    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")

    result = await db.users.update_one({"user_id": student_id, "role": "student"}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Student not found")
    return {"message": "Student updated"}


@api_router.post("/admin/students/{student_id}/change-password")
async def admin_change_student_password(
    student_id: str,
    input_data: StudentPasswordChangeInput,
    user: Dict = Depends(admin_user),
):
    await verify_admin_password(user, input_data.admin_password)
    result = await db.users.update_one(
        {"user_id": student_id, "role": "student"},
        {"$set": {"password_hash": hash_password(input_data.new_password)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Student not found")
    return {"message": "Student password changed"}


@api_router.delete("/admin/students/{student_id}")
async def delete_student(student_id: str, input_data: AdminPasswordInput, user: Dict = Depends(admin_user)):
    await verify_admin_password(user, input_data.admin_password)
    result = await db.users.delete_one({"user_id": student_id, "role": "student"})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Student not found")
    await db.student_subject_assignments.delete_many({"student_id": student_id})
    await db.attendance.delete_many({"student_id": student_id})
    return {"message": "Student deleted"}


@api_router.get("/admin/insights", response_model=AdminInsightsResponse)
async def admin_insights(_: Dict = Depends(admin_user)):
    students = await db.users.find(
        {"role": "student", "approved": True},
        {"_id": 0, "user_id": 1, "name": 1, "course_id": 1, "profile_image_base64": 1},
    ).to_list(3000)
    courses = await db.courses.find({}, {"_id": 0, "course_id": 1, "name": 1}).to_list(1000)
    course_map = {item["course_id"]: item["name"] for item in courses}
    subjects = await db.subjects.find({}, {"_id": 0, "subject_id": 1, "name": 1, "course_id": 1}).to_list(4000)
    subject_map = {item["subject_id"]: item for item in subjects}
    assignments = await db.student_subject_assignments.find({}, {"_id": 0}).to_list(5000)
    attendance = await db.attendance.find(
        {"subject_id": {"$exists": True}},
        {"_id": 0, "student_id": 1, "subject_id": 1, "status": 1},
    ).to_list(50000)

    stats: Dict[str, Dict[str, Dict[str, int]]] = {}
    for record in attendance:
        student_id = record["student_id"]
        subject_id = record["subject_id"]
        if student_id not in stats:
            stats[student_id] = {}
        if subject_id not in stats[student_id]:
            stats[student_id][subject_id] = {"present": 0, "total": 0}
        stats[student_id][subject_id]["total"] += 1
        if record["status"] == "present":
            stats[student_id][subject_id]["present"] += 1

    assignment_map = {item["student_id"]: item.get("subject_ids", []) for item in assignments}
    insights: List[StudentInsight] = []
    for student in students:
        student_subjects = assignment_map.get(student["user_id"], [])
        subject_items: List[SubjectPercent] = []
        for subject_id in student_subjects:
            subject_info = subject_map.get(subject_id)
            if not subject_info:
                continue
            subject_stats = stats.get(student["user_id"], {}).get(subject_id, {"present": 0, "total": 0})
            total = subject_stats["total"]
            present = subject_stats["present"]
            percentage = round((present / total) * 100, 2) if total else 0.0
            subject_items.append(
                SubjectPercent(
                    subject_id=subject_id,
                    subject_name=subject_info["name"],
                    present=present,
                    total=total,
                    percentage=percentage,
                )
            )

        course_id = student.get("course_id") or "unassigned"
        if not subject_items:
            continue

        calendar_records = await db.attendance.find(
            {"student_id": student["user_id"]},
            {"_id": 0, "date": 1, "status": 1, "subject_id": 1},
        ).to_list(5000)

        # append total attendance count in subject names for admin detail visibility
        for subject_item in subject_items:
            count = len([item for item in calendar_records if item.get("subject_id") == subject_item.subject_id])
            subject_item.subject_name = f"{subject_item.subject_name} (Total: {count})"

        insights.append(
            StudentInsight(
                course_id=course_id,
                course_name=course_map.get(course_id, "Unassigned"),
                student_id=student["user_id"],
                student_name=student["name"],
                profile_image_base64=student.get("profile_image_base64", ""),
                subjects=subject_items,
            )
        )

    insights.sort(key=lambda item: (item.course_name, item.student_name))
    return AdminInsightsResponse(insights=insights)


@api_router.get("/admin/notifications", response_model=List[NotificationOutput])
async def admin_notifications(_: Dict = Depends(admin_user)):
    notifications = await db.notifications.find({}, {"_id": 0}).to_list(5000)
    notifications.sort(key=lambda item: item["created_at"], reverse=True)
    return [NotificationOutput(**item) for item in notifications]


@api_router.post("/admin/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, _: Dict = Depends(admin_user)):
    await db.notifications.update_one({"notification_id": notification_id}, {"$set": {"read": True}})
    return {"message": "Notification marked read"}


@api_router.post("/admin/reset-all")
async def admin_reset_all(input_data: AdminPasswordInput, user: Dict = Depends(admin_user)):
    await verify_admin_password(user, input_data.admin_password)

    await db.users.delete_many({})
    await db.courses.delete_many({})
    await db.subjects.delete_many({})
    await db.student_subject_assignments.delete_many({})
    await db.attendance.delete_many({})
    await db.notifications.delete_many({})

    default_phone = os.environ.get("DEFAULT_ADMIN_PHONE", "+919999999999")
    default_password = os.environ.get("DEFAULT_ADMIN_PASSWORD", "admin123")
    default_admin = {
        "user_id": str(uuid.uuid4()),
        "name": "Super Admin",
        "phone_number": default_phone,
        "password_hash": hash_password(default_password),
        "role": "admin",
        "approved": True,
        "course_id": None,
        "profile_image_base64": "",
        "college_id": COLLEGE_ID,
        "created_at": utc_now_iso(),
    }
    await db.users.insert_one(default_admin.copy())

    return {
        "message": "All data reset complete",
        "default_admin_phone": default_phone,
        "default_admin_password": default_password,
    }


@api_router.get("/student/subjects", response_model=List[SubjectOutput])
async def student_subjects(user: Dict = Depends(approved_student_user)):
    assignment = await db.student_subject_assignments.find_one({"student_id": user["user_id"]}, {"_id": 0})
    subject_ids = assignment.get("subject_ids", []) if assignment else []
    if not subject_ids:
        return []
    subjects = await db.subjects.find(
        {"subject_id": {"$in": subject_ids}},
        {"_id": 0, "subject_id": 1, "course_id": 1, "name": 1, "code": 1, "created_at": 1},
    ).to_list(1000)
    subjects.sort(key=lambda item: item["name"])
    return subjects


@api_router.get("/student/attendance", response_model=List[AttendanceRecord])
async def student_attendance(
    subject_id: Optional[str] = Query(default=None),
    user: Dict = Depends(approved_student_user),
):
    query: Dict[str, str] = {"student_id": user["user_id"]}
    if subject_id:
        query["subject_id"] = subject_id
    records = await db.attendance.find(query, {"_id": 0}).to_list(10000)
    records.sort(key=lambda item: item["date"], reverse=True)
    return [AttendanceRecord(**item) for item in records]


@api_router.get("/student/insights", response_model=List[SubjectPercent])
async def student_insights(user: Dict = Depends(approved_student_user)):
    assignment = await db.student_subject_assignments.find_one({"student_id": user["user_id"]}, {"_id": 0})
    subject_ids = assignment.get("subject_ids", []) if assignment else []
    if not subject_ids:
        return []

    subjects = await db.subjects.find(
        {"subject_id": {"$in": subject_ids}},
        {"_id": 0, "subject_id": 1, "name": 1},
    ).to_list(1000)
    subject_name_map = {item["subject_id"]: item["name"] for item in subjects}

    records = await db.attendance.find(
        {"student_id": user["user_id"], "subject_id": {"$in": subject_ids}},
        {"_id": 0, "subject_id": 1, "status": 1},
    ).to_list(20000)

    stats: Dict[str, Dict[str, int]] = {sid: {"present": 0, "total": 0} for sid in subject_ids}
    for record in records:
        sid = record["subject_id"]
        stats[sid]["total"] += 1
        if record["status"] == "present":
            stats[sid]["present"] += 1

    output: List[SubjectPercent] = []
    for sid in subject_ids:
        total = stats[sid]["total"]
        present = stats[sid]["present"]
        output.append(
            SubjectPercent(
                subject_id=sid,
                subject_name=subject_name_map.get(sid, "Unknown Subject"),
                present=present,
                total=total,
                percentage=round((present / total) * 100, 2) if total else 0.0,
            )
        )
    output.sort(key=lambda item: item.subject_name)
    return output


@api_router.patch("/student/profile")
async def student_update_profile(input_data: StudentProfileUpdateInput, user: Dict = Depends(approved_student_user)):
    updates = {}
    if input_data.name is not None:
        updates["name"] = normalize_text(input_data.name)
    if input_data.profile_image_base64 is not None:
        updates["profile_image_base64"] = input_data.profile_image_base64
    if input_data.course_id is not None:
        if input_data.course_id:
            course = await db.courses.find_one({"course_id": input_data.course_id}, {"_id": 0, "course_id": 1})
            if not course:
                raise HTTPException(status_code=404, detail="Course not found")
            updates["course_id"] = input_data.course_id
        else:
            updates["course_id"] = None

    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")

    await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    await push_notification(f"{user['name']} updated profile details", "student_profile_updated", user["user_id"])
    return {"message": "Profile updated"}


@api_router.patch("/student/password")
async def student_change_password(input_data: StudentSelfPasswordInput, user: Dict = Depends(approved_student_user)):
    if not verify_password(input_data.current_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password incorrect")

    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": hash_password(input_data.new_password)}},
    )
    await push_notification(f"{user['name']} changed password", "student_password_changed", user["user_id"])
    return {"message": "Password changed"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup_event():
    await ensure_college_profile()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
