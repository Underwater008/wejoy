import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import type { UserRole } from "@wejoy/domain";
import type { Database } from "./database.js";
import { conflict, unauthorized } from "./errors.js";

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
  displayName: string;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  role: UserRole;
  display_name: string;
}

export interface RegisterInput {
  username: string;
  password: string;
  displayName: string;
  role: Exclude<UserRole, "operator">;
}

export interface AuthResult {
  token: string;
  user: AuthenticatedUser;
}

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;

export function createPasswordRecord(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("base64");
  return {
    hash: scryptSync(password, salt, 64).toString("base64"),
    salt
  };
}

export class AuthService {
  constructor(private readonly database: Database) {}

  register(input: RegisterInput): AuthResult {
    const username = input.username.trim().toLowerCase();
    const existing = this.database.sqlite
      .prepare("SELECT id FROM users WHERE username = ?")
      .get(username);
    if (existing) {
      throw conflict("That username is already registered", "USERNAME_TAKEN");
    }

    const id = `usr_${randomUUID()}`;
    const now = new Date().toISOString();
    const password = createPasswordRecord(input.password);

    this.database.transaction(() => {
      this.database.sqlite
        .prepare(
          `INSERT INTO users
            (id, username, password_hash, password_salt, role, display_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, username, password.hash, password.salt, input.role, input.displayName.trim(), now);

      if (input.role === "merchant") {
        this.database.sqlite
          .prepare(
            `INSERT INTO merchants
              (user_id, name, description, address, prep_minutes, is_open)
             VALUES (?, ?, ?, ?, 20, 1)`
          )
          .run(id, input.displayName.trim(), "社区商家", "请在商家设置中填写地址");
      }

      if (input.role === "rider") {
        this.database.sqlite
          .prepare(
            `INSERT INTO riders
              (user_id, minimum_fee_fen, is_available, transport, completed_deliveries)
             VALUES (?, 600, 1, 'ebike', 0)`
          )
          .run(id);
      }
    });

    return this.createSession(this.getUserById(id));
  }

  login(usernameInput: string, password: string): AuthResult {
    const username = usernameInput.trim().toLowerCase();
    const row = this.database.sqlite
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username) as unknown as UserRow | undefined;

    if (!row) {
      throw unauthorized("Username or password is incorrect");
    }

    const actual = Buffer.from(row.password_hash, "base64");
    const supplied = scryptSync(password, row.password_salt, actual.length);
    if (!timingSafeEqual(actual, supplied)) {
      throw unauthorized("Username or password is incorrect");
    }

    return this.createSession(this.mapUser(row));
  }

  authenticate(authorizationHeader: string | undefined): AuthenticatedUser {
    const token = authorizationHeader?.startsWith("Bearer ")
      ? authorizationHeader.slice("Bearer ".length).trim()
      : "";
    if (!token) {
      throw unauthorized();
    }

    const tokenHash = this.hashToken(token);
    const row = this.database.sqlite
      .prepare(
        `SELECT u.*
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`
      )
      .get(tokenHash, new Date().toISOString()) as unknown as UserRow | undefined;

    if (!row) {
      throw unauthorized("Session is invalid or expired");
    }

    return this.mapUser(row);
  }

  logout(authorizationHeader: string | undefined): void {
    const token = authorizationHeader?.startsWith("Bearer ")
      ? authorizationHeader.slice("Bearer ".length).trim()
      : "";
    if (token) {
      this.database.sqlite
        .prepare("DELETE FROM sessions WHERE token_hash = ?")
        .run(this.hashToken(token));
    }
  }

  getUserById(id: string): AuthenticatedUser {
    const row = this.database.sqlite
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(id) as unknown as UserRow | undefined;
    if (!row) {
      throw unauthorized("Account no longer exists");
    }
    return this.mapUser(row);
  }

  private createSession(user: AuthenticatedUser): AuthResult {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    this.database.sqlite
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        this.hashToken(token),
        user.id,
        new Date(now.getTime() + SESSION_DURATION_MS).toISOString(),
        now.toISOString()
      );

    return { token, user };
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private mapUser(row: UserRow): AuthenticatedUser {
    return {
      id: row.id,
      username: row.username,
      role: row.role,
      displayName: row.display_name
    };
  }
}
