import redis.asyncio as redis
from app.core.config import settings
from typing import Optional
import json

class RedisClient:
    def __init__(self):
        self.redis: Optional[redis.Redis] = None
    
    async def connect(self):
        self.redis = await redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True
        )
    
    async def disconnect(self):
        if self.redis:
            await self.redis.close()
    
    async def get(self, key: str):
        if not self.redis:
            return None
        value = await self.redis.get(key)
        if value:
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return None
    
    async def set(self, key: str, value, expire: int = 3600):
        if not self.redis:
            return
        if isinstance(value, (dict, list)):
            value = json.dumps(value)
        await self.redis.set(key, value, ex=expire)
    
    async def delete(self, key: str):
        if not self.redis:
            return
        await self.redis.delete(key)
    
    async def clear_cache(self, pattern: str = "*"):
        if not self.redis:
            return
        keys = []
        async for key in self.redis.scan_iter(match=pattern):
            keys.append(key)
        if keys:
            await self.redis.delete(*keys)


redis_client = RedisClient()
