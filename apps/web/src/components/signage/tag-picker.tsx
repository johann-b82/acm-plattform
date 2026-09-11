"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { signageApi, signageKeys } from "@/lib/signage/api";
import { Badge } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";

/**
 * Chip-Eingabe für Tags. Arbeitet auf Namen; der Aufrufer löst sie beim
 * Speichern über `signageApi.resolveTagIds` in IDs auf und legt neue an.
 *
 * Tastatur: Enter oder Komma übernimmt, Rücktaste löscht den letzten Chip,
 * Escape schließt die Vorschlagsliste.
 */
export function TagPicker({
  value,
  onChange,
  disabled,
  placeholder,
  ariaLabel = "Tags",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const worte = useTexte();
  const text = placeholder ?? worte.signage.tagEingeben;
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const { data: allTags = [] } = useQuery({
    queryKey: signageKeys.tags(),
    queryFn: signageApi.listTags,
    staleTime: 60_000,
  });

  const trimmed = inputValue.trim();
  const known = new Set(allTags.map((t) => t.name.toLowerCase()));
  const suggestions = allTags
    .filter((t) => t.name.toLowerCase().includes(trimmed.toLowerCase()) && !value.includes(t.name))
    .slice(0, 8);
  const showCreate = trimmed.length > 0 && !known.has(trimmed.toLowerCase()) && !value.includes(trimmed);

  function commit(tag: string) {
    const next = tag.trim();
    if (!next || value.includes(next)) return;
    onChange([...value, next]);
    setInputValue("");
    setIsOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (trimmed) commit(trimmed);
      return;
    }
    if (event.key === "Backspace" && inputValue === "" && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
      return;
    }
    if (event.key === "Escape") setIsOpen(false);
  }

  return (
    <div className="relative">
      <div
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-9 cursor-text flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
      >
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1">
            <span>{tag}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`${tag} entfernen`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(value.filter((v) => v !== tag));
              }}
              className="rounded p-0.5 hover:bg-[var(--border)]"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          ref={inputRef}
          value={inputValue}
          disabled={disabled}
          onChange={(e) => {
            setInputValue(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? text : ""}
          className="min-w-28 flex-1 bg-transparent outline-none"
        />
      </div>

      {isOpen && (suggestions.length > 0 || showCreate) && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full min-w-48 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg"
        >
          {suggestions.map((tag) => (
            <li
              key={tag.id}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(tag.name);
              }}
              className="cursor-pointer px-3 py-1.5 text-sm hover:bg-[var(--muted)]"
            >
              {tag.name}
            </li>
          ))}
          {showCreate && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(trimmed);
              }}
              className="cursor-pointer px-3 py-1.5 text-sm text-[var(--ring)] hover:bg-[var(--muted)]"
            >
              „{trimmed}“ neu anlegen
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
