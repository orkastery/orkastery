/** Prova pública de recibos: a chave de ingresso permanece no host confiável.
 * A raiz de confiança vem do ambiente de startup, nunca do recibo ou de toolargs.
 * O filho pode verificar provas, mas não emitir uma para outros bytes/identidades.
 */
import { createHash, createHmac, createPrivateKey, createPublicKey, randomUUID, sign, timingSafeEqual, verify } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { nativeBinding, nativeKey } from './hitl-native';

export const ENV_HITL_VERIFIERS = 'ORK_RECEIPT_VERIFIERS';
const slots = ['telegram:legacy', 'telegram:hermes', 'telegram:openclaw', 'native:hermes', 'native:openclaw'] as const;
type Slot = typeof slots[number];
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const verifierSchema = z.object({ publicKey: z.string().max(128), bindingSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const bundleSchema = z.object({ schema: z.literal('ork.hitl-verifiers/v1'),
  verifiers: z.record(z.enum(slots), verifierSchema) }).strict();
type Verifier = z.infer<typeof verifierSchema>;
const slotFor = (canal: string | null, native: boolean): Slot => {
  const slot = `${native ? 'native' : 'telegram'}:${canal ?? 'legacy'}`;
  if (!(slots as readonly string[]).includes(slot)) throw Error('hitl.receipt.authority');
  return slot as Slot;
};

function material(slot: Slot, env: NodeJS.ProcessEnv): { key: string; binding: unknown } {
  if (slot.startsWith('native:')) {
    const host = slot.slice(7);
    return { key: nativeKey(host, env), binding: nativeBinding(host, env) };
  }
  const host = slot.slice(9), suffix = host === 'legacy' ? '' : `_${host.toUpperCase()}`;
  const key = env[`ORK_HITL_INGRESS_KEY${suffix}`] ?? '';
  if (Buffer.byteLength(key) < 32 || (host !== 'legacy' && key === env[
    `ORK_HITL_INGRESS_KEY_${host === 'hermes' ? 'OPENCLAW' : 'HERMES'}`])) throw Error('hitl.receipt.credentials');
  const binding = host === 'openclaw' ? env.ORK_HITL_OPENCLAW_ACCOUNT?.trim() : null;
  if (host === 'openclaw' && !binding) throw Error('hitl.receipt.credentials');
  return { key, binding };
}
function signingKey(key: string, slot: Slot) {
  const seed = createHmac('sha256', key).update(`ork.hitl-public-receipt/v1:${slot}`).digest();
  return createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der', type: 'pkcs8' });
}
function inherited(env: NodeJS.ProcessEnv): Partial<Record<Slot, Verifier>> {
  const raw = env[ENV_HITL_VERIFIERS];
  if (!raw) return {};
  if (Buffer.byteLength(raw) > 4096) throw Error('hitl.receipt.verifiers-invalid');
  return bundleSchema.parse(JSON.parse(raw)).verifiers;
}
/** Somente material público; é seguro transportar em config/env do filho. */
export function publicHitlVerifiers(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const verifiers = inherited(env);
  for (const slot of slots) {
    const host = slot.split(':')[1];
    const name = slot.startsWith('native:') ? `ORK_HITL_NATIVE_KEY_${host.toUpperCase()}` :
      `ORK_HITL_INGRESS_KEY${host === 'legacy' ? '' : `_${host.toUpperCase()}`}`;
    // Configuração privada presente prevalece: chave inválida/rotacionada não cai
    // silenciosamente num verificador público herdado da configuração anterior.
    if (env[name] !== undefined) {
      delete verifiers[slot];
      try {
        const m = material(slot, env);
        verifiers[slot] = { publicKey: createPublicKey(signingKey(m.key, slot)).export({ format: 'der', type: 'spki' }).toString('base64'),
          bindingSha256: sha(m.binding) };
      } catch { /* canal não provisionado não ganha autoridade de verificação */ }
    }
  }
  return Object.keys(verifiers).length ? JSON.stringify({ schema: 'ork.hitl-verifiers/v1', verifiers }) : undefined;
}
export function publicReceiptAuthority(canal: string | null, native: boolean): Verifier | undefined {
  return inherited(process.env)[slotFor(canal, native)];
}
export function publicBindingMatches(authority: Verifier, binding: unknown): boolean {
  return authority.bindingSha256 === sha(binding);
}
/** Sidecar aditivo: recibo HMAC original e hash do ledger permanecem intactos. */
export function signPublicReceipt(file: string, canal: string | null, native: boolean): void {
  const slot = slotFor(canal, native), m = material(slot, process.env);
  const bytes = readRegular(file, 1048576);
  const receipt = JSON.parse(bytes.toString('utf8'));
  if (!/^[a-f0-9]{64}$/.test(receipt.assinatura ?? '') || !timingSafeEqual(Buffer.from(receipt.assinatura, 'hex'),
    createHmac('sha256', m.key).update(JSON.stringify(receipt.dados)).digest())) throw Error('hitl.receipt.mac-invalid');
  const proof = JSON.stringify({ schema: 'ork.hitl-public-receipt/v1',
    signature: sign(null, bytes, signingKey(m.key, slot)).toString('base64') });
  const proofFile = `${file}.public`;
  const temporary = path.join(path.dirname(file), `${randomUUID()}.public.tmp`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, proof); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    try { fs.linkSync(temporary, proofFile); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally { fs.unlinkSync(temporary); }
  // Não substitui um sidecar divergente ou symlink encontrado no estado.
  if (readRegular(proofFile, 1024).toString('utf8') !== proof) throw Error('hitl.receipt.proof-conflict');
}
function readRegular(file: string, max: number): Buffer {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid?.() || (st.mode & 0o777) !== 0o600 || st.size > max)
      throw Error('hitl.receipt.proof-invalid');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
export function verifyPublicReceipt(file: string, bytes: Buffer, authority: Verifier): boolean {
  const proof = z.object({ schema: z.literal('ork.hitl-public-receipt/v1'),
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict().parse(JSON.parse(readRegular(`${file}.public`, 1024).toString('utf8')));
  const key = createPublicKey({ key: Buffer.from(authority.publicKey, 'base64'), format: 'der', type: 'spki' });
  return key.asymmetricKeyType === 'ed25519' && verify(null, bytes, key, Buffer.from(proof.signature, 'base64'));
}
