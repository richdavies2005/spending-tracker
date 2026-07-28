import type { Category } from "../lib/types";

// Income first, then expenses, then transfers — each its own labelled group.
const GROUPS: { kind: Category["kind"]; label: string }[] = [
  { kind: "income", label: "Income categories" },
  { kind: "expense", label: "Expense categories" },
  { kind: "transfer", label: "Transfer categories" },
];

/// Grouped, alphabetised <optgroup>s for a category <select>. The raw list comes
/// back in creation order, which is hard to scan; grouping by kind and sorting
/// A–Z makes a specific category quick to find. Empty groups are omitted.
export function CategoryOptGroups({ cats }: { cats: Category[] }) {
  return (
    <>
      {GROUPS.map(({ kind, label }) => {
        const inGroup = cats
          .filter((c) => c.kind === kind)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
        if (inGroup.length === 0) return null;
        return (
          <optgroup key={kind} label={label}>
            {inGroup.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}
