# Design System Master File — Hotel Desk (Nhóm 3)

> Persisted via `ui-ux-pro-max` workflow and tailored for a light-mode B2B Hospitality Operations Console (`React 19` + `Vite` + `Lucide`).

---

## Global Rules

### Color Palette (WCAG AA >= 4.5:1 Light Mode)

| Role | Hex | CSS Variable | Usage |
| --- | --- | --- | --- |
| Primary Navy | `#0F243E` | `--navy` | Sidebar, Login story, primary dark headings |
| Primary CTA | `#1D4ED8` | `--primary` | Primary buttons, active links, focus actions |
| Primary Hover | `#1E40AF` | `--primary-hover` | Hover state for primary CTA |
| Accent Gold | `#A16207` | `--accent-gold` | Warm hospitality badge/highlight accent |
| Background | `#F8FAFC` | `--bg` | App workspace canvas |
| Surface | `#FFFFFF` | `--surface` | Cards, sections, tables, modals |
| Surface Muted | `#F1F5F9` | `--surface-muted` | Table headers, subtle callouts, input fill |
| Foreground | `#0F172A` | `--text` | Primary body and heading text |
| Muted Text | `#475569` | `--muted` | Secondary labels, helper text (contrast >= 7:1 on white) |
| Border | `#E2E8F0` | `--border` | Card/table separators |
| Border Strong | `#CBD5E1` | `--border-strong` | Form inputs and button outlines |
| Success | `#047857` | `--success` | Available rooms, completed stays, cash in |
| Warning | `#B45309` | `--warning` | Cleaning rooms, pending drafts, pending refunds |
| Danger | `#B91C1C` | `--danger` | Validation errors, maintenance, destructive restore warning |
| Focus Ring | `#2563EB` | `--ring` | 2px–3px focus outline on keyboard navigation |

### Typography

- **Font Family:** `'Be Vietnam Pro', 'Segoe UI', system-ui, -apple-system, sans-serif` (Vietnamese diacritic support + crisp metrics).
- **Tabular Figures:** `font-variant-numeric: tabular-nums` on all prices, VND amounts, counts, room numbers, dates, and table numeric columns.
- **Line Height:** `1.55`–`1.6` body, `1.25`–`1.35` headings; explanatory prose capped at `65ch`–`75ch`.

### Accessibility & Interaction Checklist

- `aria-hidden="true"` on all decorative Lucide icons beside visible text; explicit `aria-label` on icon-only controls.
- `scroll-padding-top: 88px` so sticky topbar never obscures keyboard focus.
- Focusable validation error summary (`role="alert"` + `tabIndex={-1}`) linked to invalid `#field-<key>` inputs via `aria-describedby`.
- Every status indicator pairs color with explicit Vietnamese text (never color-only).
- Charts pair SVG visual bars with direct numeric labels and full accessible HTML tables below.
- Respects `@media (prefers-reduced-motion: reduce)` and `@media print` (A4 invoice layout).
- Zero horizontal page overflow at `375px`, `768px`, `1024px`, `1440px`.
