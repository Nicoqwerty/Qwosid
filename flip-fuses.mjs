import pkg from '@electron/fuses';
const { flipFuses, FuseV1Options, FuseVersion } = pkg;
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exePath = path.join(__dirname, 'release', 'win-unpacked', 'Qwosid.exe');

console.log('Flipping fuses on:', exePath);

await flipFuses(exePath, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: false,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: false,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
});

console.log('Done!');
