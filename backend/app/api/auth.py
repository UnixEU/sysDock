from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.config import settings
from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_csrf_token,
    get_current_active_user,
    get_current_admin_user,
    SESSION_COOKIE_NAME,
    CSRF_COOKIE_NAME,
)
from app.db.session import get_db
from app.models.user import User, ROLE_ADMINISTRATOR, ROLE_VIEWER
from app.schemas.user import UserCreate, UserInDB, UserApprovalUpdate, UserRoleUpdate
from app.core.limiter import limiter

router = APIRouter()


@router.post("/login")
@limiter.limit("10/minute")
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(User).filter(User.username == form_data.username))
    user = result.scalar_one_or_none()

    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(status_code=400, detail="Account pending administrator approval")

    access_token = create_access_token(data={"sub": user.username})
    csrf_token = create_csrf_token()

    response = JSONResponse({"message": "Login successful"})
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=access_token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=csrf_token,
        httponly=False,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )
    return response


@router.post("/logout")
@limiter.limit("30/minute")
async def logout(request: Request):
    response = JSONResponse({"message": "Logged out"})
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    response.delete_cookie(key=CSRF_COOKIE_NAME, path="/")
    return response


@router.post("/register", response_model=UserInDB)
@limiter.limit("5/minute")
async def register(
    request: Request,
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db)
):
    # Check if username exists
    result = await db.execute(select(User).filter(User.username == user_data.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already registered")

    # Check if email exists
    result = await db.execute(select(User).filter(User.email == user_data.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user_count_result = await db.execute(select(func.count()).select_from(User))
    user_count = user_count_result.scalar_one()
    is_first_user = user_count == 0

    # Create new user
    new_user = User(
        username=user_data.username,
        email=user_data.email,
        full_name=user_data.full_name,
        hashed_password=get_password_hash(user_data.password),
        role=ROLE_ADMINISTRATOR if is_first_user else ROLE_VIEWER,
        is_active=is_first_user,
        is_superuser=is_first_user
    )

    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    return new_user


@router.get("/me", response_model=UserInDB)
async def get_current_user_info(
    current_user: User = Depends(get_current_active_user)
):
    return current_user


@router.get("/users", response_model=list[UserInDB])
async def list_users(
    current_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).order_by(User.created_at.asc(), User.id.asc()))
    return result.scalars().all()


@router.post("/users/{user_id}/approve", response_model=UserInDB)
@limiter.limit("20/minute")
async def approve_user(
    request: Request,
    user_id: int,
    approval: UserApprovalUpdate,
    current_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).filter(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.role = approval.role
    user.is_superuser = approval.role == ROLE_ADMINISTRATOR
    user.is_active = True
    await db.commit()
    await db.refresh(user)
    return user


@router.put("/users/{user_id}/role", response_model=UserInDB)
@limiter.limit("20/minute")
async def update_user_role(
    request: Request,
    user_id: int,
    role_update: UserRoleUpdate,
    current_user: User = Depends(get_current_admin_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).filter(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_user.id and role_update.role != ROLE_ADMINISTRATOR:
        raise HTTPException(status_code=400, detail="You cannot remove your own administrator role")

    user.role = role_update.role
    user.is_superuser = role_update.role == ROLE_ADMINISTRATOR
    await db.commit()
    await db.refresh(user)
    return user
