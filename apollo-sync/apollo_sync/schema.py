"""Table schema of the Apollo database (wire addresses and exact wire types).

`wire_schema.json` was harvested once from the projection programs the Windows driver sends
(411 of 412 tables; `Text` is missing). Per table: CONZEPT file number and per column the
sub-record (Teildatensatz), field number and wire type. The catalog type "INTEGER" is int16
for 783 of 1,960 columns — only the wire type is exact.

The schema is fixed per Apollo release. After an ERP update regenerate it on a Windows host
with the driver (see README, "Schema neu erzeugen").
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from pathlib import Path

from . import protocol as p

TYPE_NAMES = {p.T_STR: "str", p.T_DATE: "date", p.T_I16: "int16", p.T_NUM: "numeric",
              p.T_I32: "int32", p.T_I64: "int64", p.T_DBL: "double", p.T_BOOL: "bool",
              p.T_TIME: "time"}


@dataclass(frozen=True)
class Column:
    name: str
    type: int
    sub: int
    field: int

    @property
    def address(self) -> tuple[int, int, int]:
        return (self.type, self.sub, self.field)

    @property
    def type_name(self) -> str:
        return TYPE_NAMES.get(self.type, str(self.type))


@dataclass(frozen=True)
class Table:
    name: str
    file: int
    columns: tuple[Column, ...]

    def column(self, name: str) -> Column:
        for c in self.columns:
            if c.name == name:
                return c
        raise KeyError(f"{self.name} has no column {name!r}")

    def select(self, names: list[str] | None) -> tuple[Column, ...]:
        return self.columns if names is None else tuple(self.column(n) for n in names)


class Schema:
    def __init__(self, raw: dict):
        self.tables = {
            t: Table(t, v["file"], tuple(Column(c["name"], c["type"], c["sub"], c["field"])
                                         for c in v["columns"]))
            for t, v in raw.items()
        }

    def __getitem__(self, name: str) -> Table:
        try:
            return self.tables[name]
        except KeyError:
            raise KeyError(f"unknown table {name!r}") from None

    def __contains__(self, name: str) -> bool:
        return name in self.tables

    def names(self) -> list[str]:
        return sorted(self.tables)


@lru_cache(maxsize=4)
def load(path: str | None = None) -> Schema:
    if path:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    else:
        raw = json.loads(resources.files(__package__).joinpath("wire_schema.json").read_text(encoding="utf-8"))
    return Schema(raw)
