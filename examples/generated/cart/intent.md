# Intent: Shopping-cart CLI

Status: accepted

## Problem

People need a simple way to keep a shopping cart in a local file from the command line. Right now there is no tool to add items to that file, change them, remove them, or look one up.

## Proposed outcome

A TypeScript CLI that adds, edits, deletes, and views cart items in a JSON file.

- `add`: put a new item in the cart.
- `edit`: change an existing item, found by its id.
- `delete`: remove an existing item, found by its id.
- `view`: print one existing item, found by its id.

This intent leaves out listing the whole cart. That comes later.

## Affected users and systems

- Users: people who run the CLI to manage a cart.
- Systems: the cart JSON file given with `--file`, and the single source file `features/cart/cli.ts`.

## Constraints

- The whole feature lives in one file: `features/cart/cli.ts`.
- The cart is stored as a JSON array in the file given by `--file`.
- The command (`add`, `edit`, `delete`, `view`) is the first argument.
- `qty` is a number.
- If `edit`, `delete`, or `view` gets an id that is not in the cart, the CLI exits with code 1.
- `view` does not change the cart file.
- The check for this feature stays under 80 lines.

## Open questions

- What fields does an item have besides `id` and `qty` (for example `name` or `price`)?
- Who assigns the id on `add`: the user or the CLI? What happens when `add` gets an id that is already in the cart?
- What happens when the `--file` path does not exist yet? Should the CLI start an empty array or exit with an error?
- How should the CLI handle a `qty` that is not a number, or one that is zero or negative?
- What should the CLI print, if anything, after a command succeeds?
- What format does `view` print the item in: JSON or plain text?
