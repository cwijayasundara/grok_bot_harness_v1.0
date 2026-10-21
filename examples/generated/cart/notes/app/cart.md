---
id: 2026-10-21-cart-view
signature: cart-view
feature: cart
door: two-way
depends_on: []
check: "node features/cart/check.js"
---

Add view by id to the existing TypeScript CLI at features/cart/cli.ts. Do not break add, edit, or delete. view --id <id> --file <path> prints {"id","name","qty"} for that item, with qty as a number. Exit 1 when the id is missing. Before job-open, edit features/cart/check.js so it also views an existing id and asserts exit 1 for a missing id. Keep check.js under 80 lines. After job-open the check is frozen. Then implement view. Run job-open --from notes/app/cart.md and do not pass a hand-built --intent. Run verify.
