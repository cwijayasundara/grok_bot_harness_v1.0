import { existsSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

type Command = "add" | "edit" | "delete" | "view";

interface Item {
  id: string;
  name: string;
  qty: number;
}

type Cart = Item[];

interface AddArgs { command: "add"; file: string; id: string; name: string; qty: number; }
interface EditArgs { command: "edit"; file: string; id: string; name: string; qty: number; }
interface DeleteArgs { command: "delete"; file: string; id: string; }
interface ViewArgs { command: "view"; file: string; id: string; }
type Args = AddArgs | EditArgs | DeleteArgs | ViewArgs;

interface Deleted {
  deleted: string;
}

class CartError extends Error {
  code: 1 | 2;
  constructor(code: 1 | 2, message: string) {
    super(message);
    this.code = code;
  }
}

const COMMANDS: readonly Command[] = ["add", "edit", "delete", "view"];
const FLAGS: Record<Command, readonly string[]> = {
  add: ["id", "name", "qty", "file"],
  edit: ["id", "name", "qty", "file"],
  delete: ["id", "file"],
  view: ["id", "file"],
};

function usage(message: string): CartError {
  return new CartError(2, message);
}

export function parseArgs(argv: string[]): Args {
  const command = argv[0];
  if (command === undefined || !(COMMANDS as readonly string[]).includes(command)) {
    throw usage(`unknown or missing command: ${command ?? "(none)"}`);
  }
  const cmd = command as Command;
  const allowed = FLAGS[cmd];
  const flags: Record<string, string> = {};
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i += 2) {
    const raw = rest[i];
    if (!raw.startsWith("--")) throw usage(`expected a --flag, got: ${raw}`);
    const key = raw.slice(2);
    if (!allowed.includes(key)) throw usage(`unknown flag for ${cmd}: ${raw}`);
    if (Object.hasOwn(flags, key)) throw usage(`repeated flag: ${raw}`);
    const value = rest[i + 1];
    if (value === undefined) throw usage(`flag has no value: ${raw}`);
    flags[key] = value;
  }
  for (const key of allowed) {
    if (!Object.hasOwn(flags, key)) throw usage(`missing flag: --${key}`);
  }
  if (flags.id === "") throw usage("--id must not be empty");
  if (flags.file === "") throw usage("--file must not be empty");
  if (cmd === "delete" || cmd === "view") return { command: cmd, file: flags.file, id: flags.id };
  if (flags.name === "") throw usage("--name must not be empty");
  const qty = Number(flags.qty);
  if (flags.qty.trim() === "" || !Number.isFinite(qty) || qty <= 0) {
    throw usage(`--qty must be a finite number > 0, got: ${flags.qty}`);
  }
  return { command: cmd, file: flags.file, id: flags.id, name: flags.name, qty };
}

function isItem(value: unknown): value is Item {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.name === "string" && typeof v.qty === "number";
}

export function loadCart(file: string): Cart {
  if (!existsSync(file)) return [];
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw usage(`cart file is not valid JSON: ${file}`);
  }
  if (!Array.isArray(data) || !data.every(isItem)) {
    throw usage(`cart file is not a JSON array of items: ${file}`);
  }
  return data;
}

export function saveCart(file: string, cart: Cart): void {
  writeFileSync(file, JSON.stringify(cart, null, 2) + "\n");
}

export function addItem(cart: Cart, item: Item): Cart {
  if (cart.some((it) => it.id === item.id)) throw new CartError(1, `id already exists: ${item.id}`);
  return [...cart, item];
}

export function editItem(cart: Cart, item: Item): Cart {
  const index = cart.findIndex((it) => it.id === item.id);
  if (index < 0) throw new CartError(1, `id not found: ${item.id}`);
  return cart.map((it, i) => (i === index ? item : it));
}

export function deleteItem(cart: Cart, id: string): Cart {
  if (!cart.some((it) => it.id === id)) throw new CartError(1, `id not found: ${id}`);
  return cart.filter((it) => it.id !== id);
}

export function viewItem(cart: Cart, id: string): Item {
  const item = cart.find((it) => it.id === id);
  if (item === undefined) throw new CartError(1, `id not found: ${id}`);
  return { id: item.id, name: item.name, qty: item.qty };
}

export function main(argv: string[]): number {
  try {
    const args = parseArgs(argv);
    const cart = loadCart(args.file);
    if (args.command === "view") {
      process.stdout.write(JSON.stringify(viewItem(cart, args.id)) + "\n");
      return 0;
    }
    let next: Cart;
    let output: Item | Deleted;
    if (args.command === "delete") {
      next = deleteItem(cart, args.id);
      output = { deleted: args.id };
    } else {
      const item: Item = { id: args.id, name: args.name, qty: args.qty };
      next = args.command === "add" ? addItem(cart, item) : editItem(cart, item);
      output = item;
    }
    saveCart(args.file, next);
    process.stdout.write(JSON.stringify(output) + "\n");
    return 0;
  } catch (err) {
    if (err instanceof CartError) {
      process.stderr.write(`error: ${err.message}\n`);
      return err.code;
    }
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
