import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  IDENTIFIER,
  QuestionSchema,
  SOURCE_TEXT_NAME,
  VerifiedSchema,
  parseRejection,
  type Question,
  type Rejection,
  type Verified,
} from '../domain/contract.js';
import { PUBLISHED_NAME, type Store } from '../domain/ports.js';

// Layout of docs/design/evidence-desk.md §3. The ledger is the host's and is authoritative; `out` and `in` are Science's
// to tamper with: every access to them is by a descriptor opened without following a link.

const MEBIBYTE = 1024 * 1024;
const MAX_TEXT_BYTES = 5 * MEBIBYTE;
const MAX_JSON_BYTES = MEBIBYTE;

/** The flags of `node:fs` constants the store uses; `O_NOFOLLOW` and `O_NONBLOCK` are undefined where the platform has none. */
export interface OpenConstants {
  O_RDONLY: number;
  O_WRONLY: number;
  O_CREAT: number;
  O_EXCL: number;
  O_NOFOLLOW: number | undefined;
  O_NONBLOCK: number | undefined;
}

type Flags = OpenConstants & { O_NOFOLLOW: number; O_NONBLOCK: number };

export type RefusalCode =
  | 'NOFOLLOW_UNSUPPORTED'
  | 'FOLDER_NOT_CREATED'
  | 'FOLDER_NOT_A_REAL_DIRECTORY'
  | 'FOLDER_NOT_OWNED'
  | 'FOLDER_MODE_NOT_0700';
export interface Refusal {
  code: RefusalCode;
  folder: string;
  detail: string;
}
export type Opened = { ok: true; store: FsStore } | { ok: false; refusal: Refusal };

function refuse(code: RefusalCode, folder: string, detail: string): Refusal {
  return { code, folder, detail };
}

/** Creates the folder 0700 when absent (its parent must exist; the refusal carries the `code` of the error), then requires a real directory of `uid`, mode 0700. */
function checkFolder(folder: string, uid: number): Refusal | undefined {
  try {
    mkdirSync(folder, { mode: 0o700 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code as string;
    // An entry already there is judged below; anything else (ENOENT, ENOTDIR, ...) is a folder that cannot be made.
    if (code !== 'EEXIST') return refuse('FOLDER_NOT_CREATED', folder, code);
  }
  const stat = lstatSync(folder);
  if (!stat.isDirectory() || realpathSync(folder) !== folder) {
    return refuse(
      'FOLDER_NOT_A_REAL_DIRECTORY',
      folder,
      'a real directory is required: an absolute path whose last component is not a link',
    );
  }
  if (stat.uid !== uid) return refuse('FOLDER_NOT_OWNED', folder, `owner is ${stat.uid}, expected ${uid}`);
  if ((stat.mode & 0o777) !== 0o700) {
    return refuse('FOLDER_MODE_NOT_0700', folder, `mode is ${(stat.mode & 0o777).toString(8)}`);
  }
  return undefined;
}

/** The ledger and its three folders, the desk and its two, each checked in turn; the first refusal names its folder. */
export function openFsStore(ledger: string, desk: string, uid: number, constants: OpenConstants): Opened {
  const { O_NOFOLLOW, O_NONBLOCK } = constants;
  if (O_NOFOLLOW === undefined) {
    return {
      ok: false,
      refusal: refuse(
        'NOFOLLOW_UNSUPPORTED',
        desk,
        'this platform has no O_NOFOLLOW: a link cannot be refused',
      ),
    };
  }
  if (O_NONBLOCK === undefined) {
    return {
      ok: false,
      refusal: refuse(
        'NOFOLLOW_UNSUPPORTED',
        desk,
        'this platform has no O_NONBLOCK: a FIFO would block the read',
      ),
    };
  }
  const store = new FsStore(ledger, desk, { ...constants, O_NOFOLLOW, O_NONBLOCK });
  for (const folder of [
    ledger,
    store.asked,
    store.verifiedDir,
    store.ledgerSources,
    desk,
    store.out,
    store.in,
  ]) {
    const refusal = checkFolder(folder, uid);
    if (refusal !== undefined) return { ok: false, refusal };
  }
  return { ok: true, store };
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The names `<identifier><suffix>` of a folder, without the suffix, sorted. Names only: no file is read. */
function idsIn(folder: string, suffix: string): string[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith(suffix) && IDENTIFIER.test(name.slice(0, -suffix.length)))
    .map((name) => name.slice(0, -suffix.length))
    .sort();
}

export class FsStore implements Store {
  readonly asked: string;
  readonly verifiedDir: string;
  readonly ledgerSources: string;
  readonly out: string;
  readonly in: string;

  constructor(
    ledger: string,
    desk: string,
    private readonly flags: Flags,
  ) {
    this.asked = join(ledger, 'asked');
    this.verifiedDir = join(ledger, 'verified');
    this.ledgerSources = join(ledger, 'sources');
    this.out = join(desk, 'out');
    this.in = join(desk, 'in');
  }

  saveQuestion(question: Question): void {
    this.write(join(this.asked, `${question.id}.json`), json(question));
    this.write(join(this.out, `${question.id}.question.json`), json(question));
  }
  question(id: string): Question | undefined {
    const raw = this.read(this.asked, id, '.json', MAX_TEXT_BYTES);
    return raw === undefined ? undefined : QuestionSchema.parse(JSON.parse(raw));
  }
  askedIds(): string[] {
    return idsIn(this.asked, '.json');
  }
  answerIds(): string[] {
    return idsIn(this.in, '.answer.json');
  }
  answer(id: string): string | undefined {
    return this.read(this.in, id, '.answer.json', MAX_JSON_BYTES);
  }
  sourceText(name: string): string | undefined {
    return SOURCE_TEXT_NAME.test(name) ? this.readFile(join(this.in, name), MAX_TEXT_BYTES) : undefined;
  }
  rejection(id: string): Rejection | undefined {
    return parseRejection(this.read(this.out, id, '.rejected.json', MAX_JSON_BYTES));
  }
  saveRejection(rejection: Rejection): void {
    this.write(join(this.out, `${rejection.id}.rejected.json`), json(rejection));
  }
  saveVerified(record: Verified, texts: ReadonlyMap<string, string>): void {
    for (const [sha256, text] of texts) this.write(join(this.ledgerSources, `${sha256}.txt`), text);
    this.write(join(this.verifiedDir, `${record.id}.json`), json(record));
    // The record is written before the rejection goes: if `out/<id>.rejected.json` is a directory, `unlinkSync` throws
    // (EISDIR, EPERM on some platforms) and the error propagates, with the verified record already in the ledger. The
    // next run sees the identifier as verified and does not come back to it; the entry in `out` is left for the owner.
    try {
      unlinkSync(join(this.out, `${record.id}.rejected.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  verified(id: string): Verified | undefined {
    const raw = this.read(this.verifiedDir, id, '.json', MAX_TEXT_BYTES);
    return raw === undefined ? undefined : VerifiedSchema.parse(JSON.parse(raw));
  }
  verifiedIds(): string[] {
    return idsIn(this.verifiedDir, '.json');
  }
  publish(name: string, content: string): void {
    if (!PUBLISHED_NAME.test(name)) throw new Error(`not a name of a published file: ${name}`);
    this.write(join(this.out, name), content);
  }

  private read(folder: string, id: string, suffix: string, limit: number): string | undefined {
    return IDENTIFIER.test(id) ? this.readFile(join(folder, `${id}${suffix}`), limit) : undefined;
  }

  /**
   * Opened without following a link and without blocking (a FIFO opens at once), then judged on the descriptor itself:
   * never a check by path followed by a read. The read holds `limit + 1` bytes at most whatever the file grows to after
   * the `fstat`; more than `limit` bytes is absent.
   */
  private readFile(file: string, limit: number): string | undefined {
    let descriptor: number;
    try {
      descriptor = openSync(file, this.flags.O_RDONLY | this.flags.O_NOFOLLOW | this.flags.O_NONBLOCK);
    } catch {
      return undefined;
    }
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.nlink !== 1) return undefined;
      // One read: of a regular file it gives the bytes asked for or all that remain, and never more than the buffer.
      const buffer = Buffer.alloc(limit + 1);
      const length = readSync(descriptor, buffer, 0, buffer.length, null);
      return length > limit ? undefined : buffer.toString('utf8', 0, length);
    } finally {
      closeSync(descriptor);
    }
  }

  /** A temporary file created in exclusivity, then a rename: it replaces a link at the destination, it does not follow it. */
  private write(file: string, content: string): void {
    const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = this.flags;
    const descriptor = openSync(temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600);
    try {
      writeFileSync(descriptor, content);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, file);
  }
}
