# Architecture: Shopping-cart CLI

Status: proposed
Source: `intent.md` (accepted)

This file holds the requirements and the design. It answers the open questions in `intent.md`, so a worker can build the feature without guessing.

## File layout

```
cart/
  intent.md              # the accepted intent (frozen snapshot input)
  architecture.md        # this file
  package.json           # unchanged: "type": "module", no dependencies
  features/
    cart/
      cli.ts             # the whole feature (only source file)
      check.js           # the gate: runs cli.ts end to end, under 80 lines
```

- No other source files, no `tsconfig.json`, no build step, no dependencies.
- `cli.ts` runs directly with Node's built-in type stripping (Node ≥ 23.6; this machine has v24.1.0):
  `node features/cart/cli.ts <command> ...`
- Because of that, `cli.ts` may only use erasable TypeScript syntax. That means no `enum`, no `namespace`, and no constructor parameter properties. Imports use `node:` specifiers (`node:fs`, `node:process`).

## Decisions on the open questions

| Question | Decision |
|---|---|
| Item fields | `id` (string), `name` (string), `qty` (number). No other fields. |
| Who assigns the id on `add` | The user, with `--id`. |
| `add` with an id already in the cart | Exit 1. Nothing is printed to stdout and the file is not changed. |
| `--file` path does not exist | Treat it as an empty cart `[]`. `add` creates the file. `edit` and `delete` then exit 1, because the id is missing, and do not create the file. |
| `qty` is not a number, or is ≤ 0 | Exit 2 (usage error). `qty` must be a finite number > 0. |
| Output on success | One line of JSON on stdout, then a newline (see the CLI section). |
| `view` output format | JSON: the stored item as `{"id","name","qty"}`, the same shape `add` and `edit` print. |
| `view` with an id not in the cart | Exit 1. Nothing is printed to stdout. |
| `view` when `--file` does not exist | Treated as an empty cart, so the id is missing: exit 1. The file is not created. |

## TypeScript types

```ts
type Command = "add" | "edit" | "delete" | "view";

interface Item {
  id: string;
  name: string;
  qty: number;
}

type Cart = Item[];

interface AddArgs    { command: "add";    file: string; id: string; name: string; qty: number; }
interface EditArgs   { command: "edit";   file: string; id: string; name: string; qty: number; }
interface DeleteArgs { command: "delete"; file: string; id: string; }
interface ViewArgs   { command: "view";   file: string; id: string; }
type Args = AddArgs | EditArgs | DeleteArgs | ViewArgs;

interface Deleted {
  deleted: string;
}

// Thrown by any step; main() catches it, writes message to stderr, exits with code.
class CartError extends Error {
  code: 1 | 2;
  constructor(code: 1 | 2, message: string) { super(message); this.code = code; }
}
```

### Functions in `cli.ts`

| Function | Signature | Job |
|---|---|---|
| `parseArgs` | `(argv: string[]) => Args` | Reads the command from `argv[0]` and the flags after it. Throws `CartError(2)` on bad usage. |
| `loadCart` | `(file: string) => Cart` | Returns `[]` if the file does not exist. Throws `CartError(2)` if the content is not valid JSON or is not an array. |
| `saveCart` | `(file: string, cart: Cart) => void` | Writes `JSON.stringify(cart, null, 2) + "\n"`. |
| `addItem` | `(cart: Cart, item: Item) => Cart` | Throws `CartError(1)` if the id already exists. Otherwise appends the item. |
| `editItem` | `(cart: Cart, item: Item) => Cart` | Throws `CartError(1)` if the id is missing. Otherwise replaces the item at the same index. |
| `deleteItem` | `(cart: Cart, id: string) => Cart` | Throws `CartError(1)` if the id is missing. Otherwise removes the item. |
| `viewItem` | `(cart: Cart, id: string) => Item` | Throws `CartError(1)` if the id is missing. Otherwise returns the stored item. |
| `main` | `(argv: string[]) => number` | Parses, loads, applies the change, saves, prints, and returns the exit code. For `view` it loads, finds, and prints; it never calls `saveCart`. |

The add, edit, delete and view functions are pure: add, edit and delete return a new array, and view returns the item without changing the cart. `saveCart` runs only after an add, edit or delete succeeds, so the file is never written when the CLI exits 1 or 2, and never written by `view`.

## Exact CLI

```
node features/cart/cli.ts add    --id <id> --name <name> --qty <qty> --file <path>
node features/cart/cli.ts edit   --id <id> --name <name> --qty <qty> --file <path>
node features/cart/cli.ts delete --id <id> --file <path>
node features/cart/cli.ts view   --id <id> --file <path>
```

### Argument rules

- The first argument is the command, and it must be `add`, `edit`, `delete` or `view`.
- Every argument after the command is a `--flag value` pair. The pairs can come in any order, and `--file <path>` is among them.
- `add` and `edit` need exactly `--id`, `--name`, `--qty` and `--file`.
- `delete` and `view` need exactly `--id` and `--file`.
- `--id` and `--name` must not be empty strings.
- `--qty` is parsed with `Number(value)`. It must be finite and > 0.
- Any of the following exits 2: an unknown or missing command, an unknown flag, a missing flag, a repeated flag, a flag with no value, or a flag that does not apply to the command.

### Behaviour and output

| Command | Success: stdout (one line + `\n`), exit 0 | Failure |
|---|---|---|
| `add` | `{"id":"<id>","name":"<name>","qty":<qty>}` | The id is already in the cart → exit 1 |
| `edit` | `{"id":"<id>","name":"<name>","qty":<qty>}` (the new item) | The id is not in the cart → exit 1 |
| `delete` | `{"deleted":"<id>"}` | The id is not in the cart → exit 1 |
| `view` | `{"id":"<id>","name":"<name>","qty":<qty>}` (the stored item) | The id is not in the cart, or the file does not exist → exit 1 |

- Output is `JSON.stringify(value)`, with keys in the order shown. `qty` is a JSON number, not a string.
- `edit` replaces the whole item, keeping its position in the array.
- `view` prints the item rebuilt in the key order `id`, `name`, `qty`, whatever order the file stores them in. It never writes the file, on success or failure.
- On any failure, stdout is empty, a single error line goes to stderr, and the file is left as it was.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Cart state error: the id is missing on `edit`, `delete` or `view`, or the id already exists on `add` |
| 2 | Usage or input error: bad arguments, a bad `qty`, or a cart file that is not a JSON array |

### Cart file format

A JSON array of `Item`, pretty-printed with 2-space indentation and a trailing newline:

```json
[
  {
    "id": "a1",
    "name": "apple",
    "qty": 3
  }
]
```

## Out of scope

- There is no `list` command. Per the intent, listing the whole cart comes later.
- No price, totals, locking, or concurrent writers.

## Gate

```
node features/cart/check.js
```

- The gate is plain JavaScript (ESM), uses only `node:` built-ins, and must stay **under 80 lines**.
- It runs the real feature: it spawns `node features/cart/cli.ts` with `spawnSync`, using a cart file in a fresh temp directory. It does not import `cli.ts` and does not lint.
- It exits 0 only when every assertion passes. On the first failure it prints the failing case and exits non-zero.
- Once written, the gate is frozen. The worker does not edit it.
- Adding `view` changes the intent, so the gate is rewritten once for the new snapshot and then frozen again. Steps 1–9 stay exactly as they are, so add, edit and delete are still covered. The old step 10 (`view` exits 2 as an unknown command) is replaced by steps 10–12 below. The gate is about 60 lines today; these steps add about four, so it stays under 80.

The gate asserts, in order, against one temp file:

1. `add --id a1 --name apple --qty 3` on a file that does not exist: exit 0, stdout `{"id":"a1","name":"apple","qty":3}`, and the file now holds `[{"id":"a1","name":"apple","qty":3}]`.
2. `add --id b2 --name bread --qty 1`: exit 0, and the file holds two items in order.
3. `add` with id `a1` again: exit 1, and the file is unchanged.
4. `edit --id a1 --name green apple --qty 5`: exit 0, stdout `{"id":"a1","name":"green apple","qty":5}`, and `a1` is still at index 0 with the new values.
5. `edit --id zz ...`: exit 1, and the file is unchanged.
6. `delete --id b2`: exit 0, stdout `{"deleted":"b2"}`, and the file holds only `a1`.
7. `delete --id zz`: exit 1, and the file is unchanged.
8. `add --id c3 --name x --qty abc`: exit 2, and the file is unchanged.
9. `--file` placed before the other flags (`add --file <path> --id d4 --name y --qty 2`): exit 0. This shows flag order is free after the command.
10. `view --id a1`: exit 0, stdout `{"id":"a1","name":"green apple","qty":5}` with `qty` as a JSON number, and the file is byte-for-byte unchanged.
11. `view --id zz`: exit 1, stdout empty, and the file is unchanged.
12. `view --id a1` with `--file` pointing at a path that does not exist: exit 1, and that path still does not exist afterwards.
