import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class NodeIdentity {
  readonly publicKey: string;

  private readonly privateKey: ReturnType<typeof createPrivateKey>;

  constructor(dataDirectory: string) {
    const identityDirectory = join(dataDirectory, "identity");
    const privateKeyPath = join(identityDirectory, "ed25519-private.pem");
    const publicKeyPath = join(identityDirectory, "ed25519-public.pem");
    mkdirSync(identityDirectory, { recursive: true });

    if (!existsSync(privateKeyPath) || !existsSync(publicKeyPath)) {
      const keys = generateKeyPairSync("ed25519");
      writeFileSync(
        privateKeyPath,
        keys.privateKey.export({ format: "pem", type: "pkcs8" }),
        { mode: 0o600 }
      );
      writeFileSync(publicKeyPath, keys.publicKey.export({ format: "pem", type: "spki" }));
    }

    this.privateKey = createPrivateKey(readFileSync(privateKeyPath));
    const publicKey = createPublicKey(readFileSync(publicKeyPath));
    this.publicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  }

  signHash(hash: string): string {
    return sign(null, Buffer.from(hash, "hex"), this.privateKey).toString("base64");
  }
}

export function hashEvent(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function verifyEventSignature(hash: string, signature: string, publicKey: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki"
    });
    return verify(null, Buffer.from(hash, "hex"), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
