import { describe, expect, it } from "vitest";
import {
  hhmmFromString,
  hhmmToString,
  minutesSince,
  weekdayMaskFromArray,
  weekdayMaskToArray,
  weekdaysLabel,
} from "../schedule";

describe("Wochentagsmaske", () => {
  it("Bit 0 ist Montag, Bit 6 ist Sonntag", () => {
    expect(weekdayMaskToArray(1)).toEqual([true, false, false, false, false, false, false]);
    expect(weekdayMaskToArray(64)).toEqual([false, false, false, false, false, false, true]);
    expect(weekdayMaskToArray(127).every(Boolean)).toBe(true);
    expect(weekdayMaskToArray(0).some(Boolean)).toBe(false);
  });

  it("ist umkehrbar", () => {
    for (const mask of [0, 1, 31, 64, 96, 127]) {
      expect(weekdayMaskFromArray(weekdayMaskToArray(mask))).toBe(mask);
    }
  });

  it("beschriftet Bereiche und Einzeltage", () => {
    expect(weekdaysLabel(31)).toBe("Mo–Fr");
    expect(weekdaysLabel(127)).toBe("täglich");
    expect(weekdaysLabel(0b1010101)).toBe("Mo, Mi, Fr, So");
    expect(weekdaysLabel(0b1000001)).toBe("Mo, So");
    expect(weekdaysLabel(0)).toBe("—");
  });
});

describe("HHMM", () => {
  it("liest gültige Zeiten", () => {
    expect(hhmmFromString("07:30")).toBe(730);
    expect(hhmmFromString("00:00")).toBe(0);
    expect(hhmmFromString("23:59")).toBe(2359);
  });

  it("lehnt ungültige Eingaben ab", () => {
    for (const bad of ["", "7:30", "24:00", "12:60", "abc", "12:5", "1230"]) {
      expect(hhmmFromString(bad)).toBeNull();
    }
  });

  it("formatiert mit führenden Nullen und lehnt Unsinn ab", () => {
    expect(hhmmToString(730)).toBe("07:30");
    expect(hhmmToString(0)).toBe("00:00");
    expect(hhmmToString(2359)).toBe("23:59");
    expect(hhmmToString(1299)).toBe(""); // Minuten > 59
    expect(hhmmToString(2400)).toBe("");
    expect(hhmmToString(-1)).toBe("");
    expect(hhmmToString(7.5)).toBe("");
  });

  it("ist für gültige Werte umkehrbar", () => {
    for (const n of [0, 730, 1200, 2359]) {
      expect(hhmmFromString(hhmmToString(n))).toBe(n);
    }
  });
});

describe("minutesSince", () => {
  it("liefert null ohne Zeitstempel", () => {
    expect(minutesSince(null)).toBeNull();
    expect(minutesSince("kein datum")).toBeNull();
  });

  it("rechnet Minuten seit dem Zeitpunkt", () => {
    const iso = new Date(Date.now() - 3 * 60_000).toISOString();
    expect(minutesSince(iso)).toBe(3);
  });
});
