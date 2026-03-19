"""Add user roles and approval flow

Revision ID: 20260317_000002
Revises: 20260316_000001
Create Date: 2026-03-17 12:20:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260317_000002"
down_revision = "20260316_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("role", sa.String(), nullable=False, server_default="viewer"),
    )

    op.execute(
        """
        UPDATE users
        SET role = CASE
            WHEN is_superuser = true THEN 'administrator'
            ELSE 'viewer'
        END
        """
    )

    op.alter_column("users", "role", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "role")
