from sqlalchemy import Column, Integer, DateTime, Float
from sqlalchemy.sql import func

from app.db.session import Base


class ResourceMetric(Base):
    __tablename__ = "resource_metrics"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    cpu_percent = Column(Float, nullable=False)
    memory_mb = Column(Float, nullable=False)

