"""Async SQLAlchemy plumbing. Each service keeps its own DeclarativeBase (so
metadata / migrations stay service-owned) and wires it up with these builders."""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


def build_engine(url: str, **kwargs):
    return create_async_engine(url, **kwargs)


def build_session_factory(engine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


def make_get_db(session_factory: async_sessionmaker[AsyncSession]):
    """Return a FastAPI dependency yielding a session from `session_factory`."""

    async def get_db() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    return get_db
