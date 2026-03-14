import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Literal, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
db_name = os.environ.get("DB_NAME", "attendance_management")
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

jwt_secret = os.environ.get("JWT_SECRET", "shree-vedha-attendance-secret")
jwt_algorithm = "HS256"
token_expiry_hours = 72

password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

app = FastAPI(title="Shree Vedha Attendance Management API")
api_router = APIRouter(prefix="/api")


class UserBase(BaseModel):
    user_id: str
    name: str
    email: EmailStr
    role: Literal["college", "student"]
    college_name: str
    approved: bool
    created_at: str


class AuthResponse(BaseModel):
    access_token: str
    message: str
    user: UserBase


class SignUpInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=6, max_length=80)
    role: Literal["college", "student"]
    college_name: str = Field(min_length=2, max_length=100)


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=80)


class SemesterCreateInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)


class SemesterOutput(BaseModel):
    semester_id: str
    name: str
    college_name: str
    created_at: str


class CourseCreateInput(BaseModel):
    semester_id: str
    name: str = Field(min_length=2, max_length=80)
    code: str = Field(min_length=2, max_length=20)


class CourseOutput(BaseModel):
    course_id: str
    semester_id: str
    name: str
    code: str
    college_name: str
    created_at: str


class AttendanceMarkInput(BaseModel):
    course_id: str
    student_id: str
    date: str
    status: Literal["present", "absent"]


class AttendanceUpdateInput(BaseModel):
    status: Literal["present", "absent"]


class AttendanceRecordOutput(BaseModel):
    record_id: str
    course_id: str
    course_name: str
    student_id: str
    student_name: str
    date: str
    status: Literal["present", "absent"]
    marked_by: str
    created_at: str
    updated_at: Optional[str] = None


class PendingStudentOutput(BaseModel):
    user_id: str
    name: str
    email: EmailStr
    college_name: str
    created_at: str


class AnalyticsCourseOutput(BaseModel):
    course_id: str
    course_name: str
    present: int
    total: int
    percentage: float


class AnalyticsResponse(BaseModel):
    overall_present: int
    overall_total: int
    overall_percentage: float
    courses: List[AnalyticsCourseOutput]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_text(value: str) -> str:
    return " ".join(value.strip().split())


def hash_password(password: str) -> str:
    return password_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_context.verify(password, hashed_password)


def create_token(user_id: str, role: str) -> str:
    expiry = datetime.now(timezone.utc) + timedelta(hours=token_expiry_hours)
    payload = {"sub": user_id, "role": role, "exp": expiry}
    return jwt.encode(payload, jwt_secret, algorithm=jwt_algorithm)


async def fetch_user_by_id(user_id: str) -> Optional[Dict]:
    return await db.users.find_one({"user_id": user_id}, {"_id": 0})


async def current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Dict:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, jwt_secret, algorithms=[jwt_algorithm])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except JWTError as err:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from err

    user = await fetch_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def college_user(user: Dict = Depends(current_user)) -> Dict:
    if user.get("role") != "college":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="College access required")
    return user


async def approved_student_user(user: Dict = Depends(current_user)) -> Dict:
    if user.get("role") != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access required")
    if not user.get("approved", False):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account approval pending")
    return user


def user_public_doc(user_doc: Dict) -> UserBase:
    return UserBase(
        user_id=user_doc["user_id"],
        name=user_doc["name"],
        email=user_doc["email"],
        role=user_doc["role"],
        college_name=user_doc["college_name"],
        approved=user_doc["approved"],
        created_at=user_doc["created_at"],
    )


@api_router.get("/")
async def root():
    return {"message": "Shree Vedha Attendance Management API running"}


@api_router.post("/auth/signup", response_model=AuthResponse)
async def signup(input_data: SignUpInput):
    clean_name = normalize_text(input_data.name)
    clean_college = normalize_text(input_data.college_name)
    email = input_data.email.lower().strip()

    existing_user = await db.users.find_one({"email": email}, {"_id": 0})
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    if input_data.role == "student":
        approved_college = await db.users.find_one(
            {
                "role": "college",
                "college_name": clean_college,
                "approved": True,
            },
            {"_id": 0, "user_id": 1},
        )
        if not approved_college:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="College not found. Ask your college admin to register first.",
            )

    new_user = {
        "user_id": str(uuid.uuid4()),
        "name": clean_name,
        "email": email,
        "password_hash": hash_password(input_data.password),
        "role": input_data.role,
        "college_name": clean_college,
        "approved": input_data.role == "college",
        "created_at": utc_now_iso(),
    }
    await db.users.insert_one(new_user.copy())

    token = create_token(new_user["user_id"], new_user["role"])
    message = "Account created" if new_user["approved"] else "Signup complete. Waiting for college approval"
    return AuthResponse(access_token=token, message=message, user=user_public_doc(new_user))


@api_router.post("/auth/login", response_model=AuthResponse)
async def login(input_data: LoginInput):
    email = input_data.email.lower().strip()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_password(input_data.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_token(user["user_id"], user["role"])
    message = "Login successful" if user["approved"] else "Login successful. Approval pending"
    return AuthResponse(access_token=token, message=message, user=user_public_doc(user))


@api_router.get("/auth/me", response_model=UserBase)
async def me(user: Dict = Depends(current_user)):
    return user_public_doc(user)


@api_router.get("/admin/pending-students", response_model=List[PendingStudentOutput])
async def admin_pending_students(user: Dict = Depends(college_user)):
    pending_students = await db.users.find(
        {
            "role": "student",
            "approved": False,
            "college_name": user["college_name"],
        },
        {"_id": 0, "password_hash": 0},
    ).to_list(1000)
    return pending_students


@api_router.post("/admin/approve-student/{student_id}")
async def admin_approve_student(student_id: str, user: Dict = Depends(college_user)):
    result = await db.users.update_one(
        {
            "user_id": student_id,
            "role": "student",
            "college_name": user["college_name"],
        },
        {"$set": {"approved": True}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    return {"message": "Student approved"}


@api_router.get("/admin/students", response_model=List[UserBase])
async def admin_students(user: Dict = Depends(college_user)):
    students = await db.users.find(
        {
            "role": "student",
            "approved": True,
            "college_name": user["college_name"],
        },
        {"_id": 0, "password_hash": 0},
    ).to_list(1000)
    return [user_public_doc(student) for student in students]


@api_router.post("/admin/semesters", response_model=SemesterOutput)
async def admin_create_semester(input_data: SemesterCreateInput, user: Dict = Depends(college_user)):
    name = normalize_text(input_data.name)
    exists = await db.semesters.find_one(
        {"name": name, "college_name": user["college_name"]},
        {"_id": 0, "semester_id": 1},
    )
    if exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Semester already exists")

    semester_doc = {
        "semester_id": str(uuid.uuid4()),
        "name": name,
        "college_name": user["college_name"],
        "created_by": user["user_id"],
        "created_at": utc_now_iso(),
    }
    await db.semesters.insert_one(semester_doc.copy())
    return SemesterOutput(**{key: semester_doc[key] for key in ["semester_id", "name", "college_name", "created_at"]})


@api_router.get("/admin/semesters", response_model=List[SemesterOutput])
async def admin_get_semesters(user: Dict = Depends(college_user)):
    semesters = await db.semesters.find(
        {"college_name": user["college_name"]},
        {"_id": 0, "semester_id": 1, "name": 1, "college_name": 1, "created_at": 1},
    ).to_list(1000)
    semesters.sort(key=lambda item: item["created_at"], reverse=True)
    return semesters


@api_router.post("/admin/courses", response_model=CourseOutput)
async def admin_create_course(input_data: CourseCreateInput, user: Dict = Depends(college_user)):
    semester = await db.semesters.find_one(
        {
            "semester_id": input_data.semester_id,
            "college_name": user["college_name"],
        },
        {"_id": 0, "semester_id": 1},
    )
    if not semester:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Semester not found")

    name = normalize_text(input_data.name)
    code = normalize_text(input_data.code).upper()

    existing_course = await db.courses.find_one(
        {
            "semester_id": input_data.semester_id,
            "college_name": user["college_name"],
            "$or": [{"name": name}, {"code": code}],
        },
        {"_id": 0, "course_id": 1},
    )
    if existing_course:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Course already exists")

    course_doc = {
        "course_id": str(uuid.uuid4()),
        "semester_id": input_data.semester_id,
        "name": name,
        "code": code,
        "college_name": user["college_name"],
        "created_by": user["user_id"],
        "created_at": utc_now_iso(),
    }
    await db.courses.insert_one(course_doc.copy())
    return CourseOutput(**{key: course_doc[key] for key in ["course_id", "semester_id", "name", "code", "college_name", "created_at"]})


@api_router.get("/admin/courses", response_model=List[CourseOutput])
async def admin_get_courses(
    semester_id: Optional[str] = Query(default=None),
    user: Dict = Depends(college_user),
):
    query = {"college_name": user["college_name"]}
    if semester_id:
        query["semester_id"] = semester_id

    courses = await db.courses.find(
        query,
        {
            "_id": 0,
            "course_id": 1,
            "semester_id": 1,
            "name": 1,
            "code": 1,
            "college_name": 1,
            "created_at": 1,
        },
    ).to_list(1000)
    courses.sort(key=lambda item: item["created_at"], reverse=True)
    return courses


@api_router.post("/admin/attendance/mark", response_model=AttendanceRecordOutput)
async def admin_mark_attendance(input_data: AttendanceMarkInput, user: Dict = Depends(college_user)):
    course = await db.courses.find_one(
        {
            "course_id": input_data.course_id,
            "college_name": user["college_name"],
        },
        {"_id": 0, "course_id": 1, "name": 1},
    )
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")

    student = await db.users.find_one(
        {
            "user_id": input_data.student_id,
            "role": "student",
            "approved": True,
            "college_name": user["college_name"],
        },
        {"_id": 0, "user_id": 1, "name": 1},
    )
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")

    existing_record = await db.attendance.find_one(
        {
            "course_id": input_data.course_id,
            "student_id": input_data.student_id,
            "date": input_data.date,
            "college_name": user["college_name"],
        },
        {"_id": 0, "record_id": 1},
    )

    now = utc_now_iso()
    if existing_record:
        await db.attendance.update_one(
            {"record_id": existing_record["record_id"]},
            {
                "$set": {
                    "status": input_data.status,
                    "marked_by": user["user_id"],
                    "updated_at": now,
                }
            },
        )
        record_id = existing_record["record_id"]
    else:
        record_id = str(uuid.uuid4())
        attendance_doc = {
            "record_id": record_id,
            "course_id": input_data.course_id,
            "course_name": course["name"],
            "student_id": input_data.student_id,
            "student_name": student["name"],
            "college_name": user["college_name"],
            "date": input_data.date,
            "status": input_data.status,
            "marked_by": user["user_id"],
            "created_at": now,
            "updated_at": None,
        }
        await db.attendance.insert_one(attendance_doc.copy())

    record = await db.attendance.find_one({"record_id": record_id}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to save attendance")
    return AttendanceRecordOutput(**record)


@api_router.put("/admin/attendance/{record_id}", response_model=AttendanceRecordOutput)
async def admin_update_attendance(
    record_id: str,
    input_data: AttendanceUpdateInput,
    user: Dict = Depends(college_user),
):
    result = await db.attendance.update_one(
        {
            "record_id": record_id,
            "college_name": user["college_name"],
        },
        {
            "$set": {
                "status": input_data.status,
                "updated_at": utc_now_iso(),
                "marked_by": user["user_id"],
            }
        },
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")

    updated_record = await db.attendance.find_one({"record_id": record_id}, {"_id": 0})
    if not updated_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")
    return AttendanceRecordOutput(**updated_record)


@api_router.delete("/admin/attendance/{record_id}")
async def admin_delete_attendance(record_id: str, user: Dict = Depends(college_user)):
    result = await db.attendance.delete_one(
        {
            "record_id": record_id,
            "college_name": user["college_name"],
        }
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attendance record not found")
    return {"message": "Attendance record deleted"}


@api_router.get("/admin/attendance", response_model=List[AttendanceRecordOutput])
async def admin_get_attendance(
    course_id: Optional[str] = Query(default=None),
    student_id: Optional[str] = Query(default=None),
    user: Dict = Depends(college_user),
):
    query: Dict[str, str] = {"college_name": user["college_name"]}
    if course_id:
        query["course_id"] = course_id
    if student_id:
        query["student_id"] = student_id

    records = await db.attendance.find(query, {"_id": 0}).to_list(5000)
    records.sort(key=lambda item: (item["date"], item["created_at"]), reverse=True)
    return [AttendanceRecordOutput(**record) for record in records]


@api_router.get("/admin/analytics", response_model=AnalyticsResponse)
async def admin_analytics(
    course_id: Optional[str] = Query(default=None),
    user: Dict = Depends(college_user),
):
    attendance_query: Dict[str, str] = {"college_name": user["college_name"]}
    if course_id:
        attendance_query["course_id"] = course_id

    records = await db.attendance.find(attendance_query, {"_id": 0}).to_list(10000)
    courses = await db.courses.find(
        {"college_name": user["college_name"]},
        {"_id": 0, "course_id": 1, "name": 1},
    ).to_list(1000)
    course_names = {item["course_id"]: item["name"] for item in courses}

    course_stats: Dict[str, Dict[str, int]] = {}
    overall_total = len(records)
    overall_present = 0

    for record in records:
        key = record["course_id"]
        if key not in course_stats:
            course_stats[key] = {"present": 0, "total": 0}
        course_stats[key]["total"] += 1
        if record["status"] == "present":
            course_stats[key]["present"] += 1
            overall_present += 1

    course_analytics: List[AnalyticsCourseOutput] = []
    for key, values in course_stats.items():
        total = values["total"]
        present = values["present"]
        percentage = round((present / total) * 100, 2) if total else 0.0
        course_analytics.append(
            AnalyticsCourseOutput(
                course_id=key,
                course_name=course_names.get(key, "Unknown Course"),
                present=present,
                total=total,
                percentage=percentage,
            )
        )

    course_analytics.sort(key=lambda item: item.percentage, reverse=True)
    overall_percentage = round((overall_present / overall_total) * 100, 2) if overall_total else 0.0
    return AnalyticsResponse(
        overall_present=overall_present,
        overall_total=overall_total,
        overall_percentage=overall_percentage,
        courses=course_analytics,
    )


@api_router.get("/student/courses", response_model=List[CourseOutput])
async def student_courses(user: Dict = Depends(approved_student_user)):
    courses = await db.courses.find(
        {"college_name": user["college_name"]},
        {
            "_id": 0,
            "course_id": 1,
            "semester_id": 1,
            "name": 1,
            "code": 1,
            "college_name": 1,
            "created_at": 1,
        },
    ).to_list(1000)
    courses.sort(key=lambda item: item["created_at"], reverse=True)
    return courses


@api_router.get("/student/attendance", response_model=List[AttendanceRecordOutput])
async def student_attendance(
    course_id: Optional[str] = Query(default=None),
    user: Dict = Depends(approved_student_user),
):
    query: Dict[str, str] = {
        "student_id": user["user_id"],
        "college_name": user["college_name"],
    }
    if course_id:
        query["course_id"] = course_id

    records = await db.attendance.find(query, {"_id": 0}).to_list(5000)
    records.sort(key=lambda item: (item["date"], item["created_at"]), reverse=True)
    return [AttendanceRecordOutput(**record) for record in records]


@api_router.get("/student/analytics", response_model=AnalyticsResponse)
async def student_analytics(user: Dict = Depends(approved_student_user)):
    records = await db.attendance.find(
        {
            "student_id": user["user_id"],
            "college_name": user["college_name"],
        },
        {"_id": 0},
    ).to_list(10000)

    course_stats: Dict[str, Dict[str, int]] = {}
    overall_total = len(records)
    overall_present = 0

    for record in records:
        course_id = record["course_id"]
        if course_id not in course_stats:
            course_stats[course_id] = {"present": 0, "total": 0}
        course_stats[course_id]["total"] += 1
        if record["status"] == "present":
            course_stats[course_id]["present"] += 1
            overall_present += 1

    course_analytics: List[AnalyticsCourseOutput] = []
    for course_id, values in course_stats.items():
        total = values["total"]
        present = values["present"]
        course_name = next(
            (record.get("course_name") for record in records if record["course_id"] == course_id),
            "Unknown Course",
        )
        course_analytics.append(
            AnalyticsCourseOutput(
                course_id=course_id,
                course_name=course_name,
                present=present,
                total=total,
                percentage=round((present / total) * 100, 2) if total else 0.0,
            )
        )

    course_analytics.sort(key=lambda item: item.percentage, reverse=True)
    overall_percentage = round((overall_present / overall_total) * 100, 2) if overall_total else 0.0
    return AnalyticsResponse(
        overall_present=overall_present,
        overall_total=overall_total,
        overall_percentage=overall_percentage,
        courses=course_analytics,
    )


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
