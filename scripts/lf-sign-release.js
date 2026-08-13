const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const defaultKey = path.join(os.homedir(), '.lumifield-release', 'update-private.pem');
const privateKeyPath = path.resolve(process.env.LF_UPDATE_PRIVATE_KEY || defaultKey);
const publicKeyPath = path.join(repo, 'build', 'lf-update-public.pem');

function ensurePrivateKey() {
  if (fs.existsSync(privateKeyPath)) return fs.readFileSync(privateKeyPath, 'utf8');
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true });
  fs.writeFileSync(privateKeyPath, privateKey, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return privateKey;
}

function publicPem(privateKey) {
  return crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
}

const args = process.argv.slice(2);
const privateKey = ensurePrivateKey();
const derivedPublic = String(publicPem(privateKey)).trim() + '\n';
if (args.includes('--init')) {
  console.log(JSON.stringify({ ok: true, privateKeyPath, publicKey: derivedPublic }));
  process.exit(0);
}

const artifactArg = args[0];
const version = String(args[1] || require('../package.json').version);
if (!artifactArg) throw new Error('Usage: npm run release:sign -- <installer-path> [version]');
const artifact = path.resolve(repo, artifactArg);
if (!fs.existsSync(artifact)) throw new Error(`Release artifact not found: ${artifact}`);
if (!fs.existsSync(publicKeyPath)) throw new Error('build/lf-update-public.pem is missing; initialize and add the public key first.');
const configuredPublic = fs.readFileSync(publicKeyPath, 'utf8').trim() + '\n';
const derivedPublicDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const configuredPublicDer = crypto.createPublicKey(configuredPublic).export({ type: 'spki', format: 'der' });
if (!Buffer.from(derivedPublicDer).equals(Buffer.from(configuredPublicDer))) {
  throw new Error('Release private key does not match build/lf-update-public.pem.');
}
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid semantic version.');

const digest = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
const signature = crypto.sign('sha256', Buffer.from(`${version}:${digest}`), privateKey).toString('base64');
if (!crypto.verify('sha256', Buffer.from(`${version}:${digest}`), configuredPublic, Buffer.from(signature, 'base64'))) throw new Error('Release signature self-check failed.');
const manifest = {
  schema: 1,
  product: 'LumiField',
  version,
  file: path.basename(artifact),
  sha256: digest,
  signature,
  signedAt: new Date().toISOString(),
};
const manifestPath = `${artifact}.release.json`;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, version, artifact, manifestPath, sha256: digest, signatureVerified: true }));
