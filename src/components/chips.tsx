"use client";

// Multi-select as large toggle buttons (bigger targets than checkboxes; keyboard: Tab + Space).
export function Chips({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className={`min-h-12 rounded-full border px-4 text-base font-medium transition-colors disabled:opacity-60 ${
              on ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            }`}
          >
            {on && <span aria-hidden="true">✓ </span>}
            {o}
          </button>
        );
      })}
    </div>
  );
}
