import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

const SITE_ID = 'adcca874-b8a6-431d-b7cc-59a3a3ac19fd';
const IMAGEKIT_SITE_ID = '385e24bd-629f-4857-9c1a-1e0dfd56de80';
const BASE_URL = 'https://matjar-yemen-official-mralmwry173.netlify.app';
const APP_ID = 'com.yemenstore.matjar_yemen';
const APK_URL = 'https://github.com/mralmwry173-ship-it/matjar-yemen-android/releases/latest/download/app-release.apk';
const RELEASE_URL = 'https://github.com/mralmwry173-ship-it/matjar-yemen-android/releases/latest';
const PAGE_MARKERS = [
  'JrQo7Y3iPPJVE6f7EC7UI28zkm3-048Zm4cjqOBH-LI',
  'app-release.apk',
  'id="developer"',
  'مهند وليد محمد الجنيد',
  '+967 779790258',
  'id="support-contact"',
  'عبدالله عبدالكريم الديلمي',
  '+967 714307945',
];
const REQUIRED_ASSETS = ['favicon.svg', 'robots.txt', 'sitemap.xml', 'sitemap.txt', 'README-AR.txt'];
const OPTIONAL_ASSETS = ['manifest.webmanifest', 'favicon.ico'];

function check(ok, message) {
  if (!ok) throw new Error(message);
}

async function downloadFile(dir, name, optional = false) {
  const response = await fetch(BASE_URL + '/' + name, {
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    if (optional && response.status === 404) return;
    throw new Error('Cannot preserve site file ' + name + ': HTTP ' + response.status);
  }
  await writeFile(join(dir, name), new Uint8Array(await response.arrayBuffer()));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(command + ' exited with code ' + code)));
  });
}

function compareVersion(a, b) {
  const av = String(a).split('.').map(Number);
  const bv = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const d = (av[i] || 0) - (bv[i] || 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

async function main() {
  check(SITE_ID !== IMAGEKIT_SITE_ID, 'Refusing to deploy to the ImageKit site.');
  check(process.env.NETLIFY_AUTH_TOKEN, 'Missing secret NETLIFY_AUTH_TOKEN.');
  check(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, 'Missing secret FIREBASE_SERVICE_ACCOUNT_JSON.');

  const version = String(process.env.APK_VERSION || '').trim();
  const build = Number(process.env.APK_BUILD);
  const tag = String(process.env.RELEASE_TAG || '').trim();
  check(/^\d+(\.\d+){1,3}$/.test(version), 'Invalid APK version: ' + version);
  check(Number.isSafeInteger(build) && build >= 0, 'Invalid APK build number.');
  check(tag === 'v' + version, 'GitHub release tag must be v' + version + '.');

  const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  check(account.project_id === 'matjar-yemen', 'Firebase service account is for the wrong project.');
  check(account.client_email && account.private_key, 'Firebase service account JSON is incomplete.');

  const previousResponse = await fetch(BASE_URL + '/app-update.json?check=' + Date.now(), {
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(20000),
  });
  if (previousResponse.ok) {
    const previous = await previousResponse.json();
    check(compareVersion(version, previous.latestVersion) >= 0, 'This release is older than the published app version.');
    check(build > Number(previous.latestBuildNumber), 'APK versionCode must be greater than the previously published build.');
  } else {
    check(previousResponse.status === 404, 'Could not read current app-update.json: HTTP ' + previousResponse.status);
  }

  console.log('Preparing version ' + version + '+' + build);
  const workDir = await mkdtemp(join(tmpdir(), 'matjar-yemen-site-'));
  const publicDir = join(workDir, 'public');
  await mkdir(publicDir, { recursive: true });

  const homeResponse = await fetch(BASE_URL + '/?publish=' + Date.now(), {
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(30000),
  });
  check(homeResponse.ok, 'Official Matjar Yemen website is not available.');
  const html = await homeResponse.text();
  for (const marker of PAGE_MARKERS) check(html.includes(marker), 'Website safety check failed; missing: ' + marker);
  await writeFile(join(publicDir, 'index.html'), html, 'utf8');

  for (const name of REQUIRED_ASSETS) await downloadFile(publicDir, name, false);
  for (const name of OPTIONAL_ASSETS) await downloadFile(publicDir, name, true);

  const notes = String(process.env.RELEASE_NOTES || '').trim().slice(0, 1200) || 'تحديثات وتحسينات تطبيق متجر يمن.';
  const manifest = {
    appId: APP_ID,
    latestVersion: version,
    latestBuildNumber: build,
    minimumSupportedVersion: '0.0.0',
    minimumSupportedBuildNumber: 0,
    forceUpdate: false,
    apkUrl: APK_URL,
    releaseUrl: RELEASE_URL,
    releaseNotes: notes,
  };
  await writeFile(join(publicDir, 'app-update.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await writeFile(join(publicDir, '_headers'), '/app-update.json\n  Cache-Control: no-store, no-cache, must-revalidate, max-age=0\n  Pragma: no-cache\n', 'utf8');

  console.log('Deploying to the official Matjar Yemen website...');
  await run('npx', ['--yes', 'netlify-cli', 'deploy', '--prod', '--dir', publicDir, '--site', SITE_ID, '--message', 'Matjar Yemen release ' + version + '+' + build]);

  const verifyResponse = await fetch(BASE_URL + '/app-update.json?verify=' + Date.now(), {
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(30000),
  });
  check(verifyResponse.ok, 'The published update manifest could not be verified.');
  const live = await verifyResponse.json();
  check(live.appId === APP_ID && live.latestVersion === version && Number(live.latestBuildNumber) === build && live.apkUrl === APK_URL, 'Published manifest values do not match this APK.');

  const firebaseApp = initializeApp({ credential: cert(account), projectId: 'matjar-yemen' });
  const messageId = await getMessaging(firebaseApp).send({
    topic: 'all_users',
    notification: {
      title: 'تحديث جديد لتطبيق متجر يمن',
      body: 'يتوفر الإصدار ' + version + ' الآن. افتح التطبيق لتحديثه والاستفادة من التحسينات الجديدة.',
    },
    data: { type: 'app_update', route: '/notifications', version, build: String(build) },
    android: { priority: 'high', notification: { channelId: 'matjar_default_channel' } },
  });

  console.log('SUCCESS: app-update.json published for ' + version + '+' + build);
  console.log('SUCCESS: FCM notification sent to topic all_users. Message ID: ' + messageId);
}

main().catch(error => {
  console.error('Matjar Yemen release automation failed:', error);
  process.exitCode = 1;
});