from datetime import datetime, timedelta
from typing import Optional
import secrets

from jose import JWTError, jwt
import bcrypt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import HTTPConnection

from app.core.config import settings
from app.db.session import get_db
from app.models.user import User, ROLE_ADMINISTRATOR

SESSION_COOKIE_NAME = "token"
CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "X-CSRF-Token"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def verify_password(plain_password: str, hashed_password: str) -> bool:
    # Bcrypt has a 72-byte password limit, truncate if necessary
    password_bytes = plain_password.encode('utf-8')[:72]
    return bcrypt.checkpw(password_bytes, hashed_password.encode('utf-8'))


def get_password_hash(password: str) -> str:
    # Bcrypt has a 72-byte password limit, truncate if necessary
    password_bytes = password.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a signed JWT access token.

    Expects `data` to include a `sub` claim (the subject, e.g. username).
    """
    to_encode = data.copy()
    if "sub" not in to_encode:
        raise ValueError("Token payload must include 'sub' claim.")

    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    to_encode.update(
        {
            "exp": expire,
            "token_type": "access",
        }
    )
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def create_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def _extract_connection_token(connection: HTTPConnection) -> tuple[Optional[str], str]:
    token = connection.cookies.get(SESSION_COOKIE_NAME)
    if token:
        return token, "cookie"

    auth_header = connection.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:], "header"

    return None, "missing"


def _extract_request_token(request: Request) -> tuple[Optional[str], str]:
    return _extract_connection_token(request)


def verify_csrf(connection: HTTPConnection) -> None:
    csrf_cookie = connection.cookies.get(CSRF_COOKIE_NAME)
    csrf_header = connection.headers.get(CSRF_HEADER_NAME)
    if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF validation failed",
        )


async def authenticate_connection(
    connection: HTTPConnection,
    db: AsyncSession,
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token, token_source = _extract_connection_token(connection)
    if not token:
        raise credentials_exception

    method = connection.scope.get("method", "").upper()
    if token_source == "cookie" and method in UNSAFE_METHODS:
        verify_csrf(connection)

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    result = await db.execute(select(User).filter(User.username == username))
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db)
) -> User:
    return await authenticate_connection(request, db)


async def get_current_active_user(
    current_user: User = Depends(get_current_user)
) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user


async def get_current_admin_user(
    current_user: User = Depends(get_current_active_user)
) -> User:
    if current_user.role != ROLE_ADMINISTRATOR or not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required",
        )
    return current_user
