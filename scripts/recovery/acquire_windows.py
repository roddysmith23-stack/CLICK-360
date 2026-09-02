"""One-launch Windows acquisition: VSS source, local private raw, safe export.

No app launch, network, auth, browser shutdown, registry/policy change, or
snapshot deletion. Uses an elevated Windows VSS operation, not live DB copying.
"""
import ctypes
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import sqlite3
import subprocess
import sys
import zipfile

from parse_client import parse_snapshot

BASE = pathlib.Path(__file__).resolve().parent


def vss_source_home(device, user_home):
    # Pure validation/join: never accidentally fall back to the live profile.
    prefix = r'\\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy'
    if not isinstance(device, str) or not device.startswith(prefix) or not device[len(prefix):].isdecimal():
        raise RuntimeError('NOT_A_VSS_SOURCE')
    home = pathlib.PureWindowsPath(user_home)
    if not home.is_absolute() or '..' in home.parts or len(home.drive) != 2:
        raise RuntimeError('PROFILE_VOLUME_UNKNOWN')
    return pathlib.PureWindowsPath(device) / home.relative_to(home.anchor)


def regular_source_files(selection):
    # Junctions can leave the immutable snapshot and point at live/unrelated
    # storage. Never follow any reparse point, including ancestor selections.
    def reparse(path):
        return path.is_symlink() or bool(getattr(path.stat(follow_symlinks=False), 'st_file_attributes', 0) & 0x400)
    if reparse(selection) or any(reparse(p) for p in selection.parents if p.exists()):
        return
    if selection.is_file():
        yield selection
        return
    for directory, names, files in os.walk(selection, followlinks=False):
        root = pathlib.Path(directory)
        names[:] = sorted(name for name in names if not reparse(root / name))
        for name in sorted(files):
            file = root / name
            if not reparse(file) and file.is_file():
                yield file


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def save(path, data):
    with path.open('x', encoding='utf8') as stream:
        json.dump(data, stream, ensure_ascii=True, indent=2)


def powershell(command, extra_env=None):
    # No ExecutionPolicy bypass or persistence changes. The native operation is
    # passed as a command; source profiles are never evaluated as code.
    env = os.environ.copy()
    env.update(extra_env or {})
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command],
                            env=env, capture_output=True, text=True, check=True)
    return json.loads(result.stdout.lstrip('\ufeff'))


def acquire():
    if os.name != 'nt':
        raise RuntimeError('WINDOWS_REQUIRED_NO_SOURCE_TOUCHED')
    config = json.loads((BASE / 'tenant-config.json').read_text(encoding='utf8'))
    if config.get('ownerUid', '').startswith('CONFIGURE_') or not config.get('tenantKey'):
        raise RuntimeError('TENANT_CONFIG_REQUIRED')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', config['operationId']):
        raise RuntimeError('INVALID_OPERATION_DIRECTORY')
    package_manifest = json.loads((BASE / 'PACKAGE_HASHES.json').read_text(encoding='utf8'))
    for entry in package_manifest['files']:
        relative = pathlib.Path(entry['path'])
        if relative.is_absolute() or '..' in relative.parts or digest(BASE / relative) != entry['sha256']:
            raise RuntimeError('PACKAGE_INTEGRITY_MISMATCH')
    user_home = pathlib.Path(sys.argv[sys.argv.index('--user-home') + 1]) if '--user-home' in sys.argv else pathlib.Path.home()
    user_sid = sys.argv[sys.argv.index('--user-sid') + 1] if '--user-sid' in sys.argv else powershell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value | ConvertTo-Json -Compress')
    if not re.fullmatch(r'S-1-[0-9-]+', user_sid):
        raise RuntimeError('INVALID_SOURCE_USER_SID')
    if not ctypes.windll.shell32.IsUserAnAdmin():
        args = subprocess.list2cmdline([str(__file__), '--user-home', str(user_home), '--user-sid', user_sid])
        result = ctypes.windll.shell32.ShellExecuteW(None, 'runas', sys.executable, args, str(BASE), 1)
        if result <= 32:
            raise RuntimeError('WINDOWS_PERMISSION_NOT_GRANTED_NO_ACQUISITION')
        return
    output = user_home / 'Desktop' / 'SHARY_PC_ACQUISITION'
    output.mkdir(exist_ok=True)
    # Stable operation directory makes repeated launching idempotent. Never
    # overwrite a prior acquisition. Later acquisition requires a new package ID.
    operation = output / config['operationId']
    if (operation / 'COMPLETE.json').exists():
        print('YA TERMINADO. Conserve esta carpeta; no se repitio ni modifico la adquisicion.')
        return
    operation.mkdir(exist_ok=True)
    raw = operation / 'RAW_PRIVADO_NO_ENVIAR'
    raw.mkdir(exist_ok=True)
    # Restrict private material to the existing Windows user and administrators.
    subprocess.run(['icacls.exe', str(raw), '/inheritance:r', '/grant:r',
                    '*' + user_sid + ':(OI)(CI)F',
                    '*S-1-5-32-544:(OI)(CI)F'], check=True, capture_output=True)
    drive = user_home.anchor
    if not drive or not user_home.is_absolute():
        raise RuntimeError('PROFILE_VOLUME_UNKNOWN')
    if shutil.disk_usage(drive).free < 8 * 1024 ** 3:
        raise RuntimeError('INSUFFICIENT_FREE_SPACE_NO_SNAPSHOT_CREATED')
    snapshot_file = operation / 'snapshot.private.json'
    if snapshot_file.exists():
        snapshot = json.loads(snapshot_file.read_text())
    else:
        # VSS can evict old recovery points when its quota is exhausted. Never
        # trade an existing recovery source for this acquisition. Inspect only;
        # do not resize shadow storage, remove snapshots or change VSS services.
        budget = powershell("$ErrorActionPreference='Stop'; @{count=@(Get-CimInstance Win32_ShadowCopy).Count;storage=@(Get-CimInstance Win32_ShadowStorage | Select-Object UsedSpace,AllocatedSpace,MaxSpace)} | ConvertTo-Json -Depth 4 -Compress")
        if budget['count'] >= 60:
            raise RuntimeError('VSS_EXISTING_SNAPSHOT_LIMIT_NO_SNAPSHOT_CREATED')
        for allocation in budget.get('storage', []):
            maximum = int(allocation['MaxSpace'])
            if maximum > 0 and maximum - int(allocation['UsedSpace']) < 2 * 1024 ** 3:
                raise RuntimeError('VSS_QUOTA_RISK_NO_SNAPSHOT_CREATED')
        snapshot = powershell("$ErrorActionPreference='Stop'; $r=Invoke-CimMethod -ClassName Win32_ShadowCopy -MethodName Create -Arguments @{Volume=$env:CLICK360_ACQUIRE_VOLUME;Context='ClientAccessible'}; if($r.ReturnValue -ne 0){throw ('VSS_CREATE_FAILED_'+$r.ReturnValue)}; $s=Get-CimInstance Win32_ShadowCopy | Where-Object ID -eq $r.ShadowID; if(-not $s){throw 'VSS_NOT_FOUND'}; @{id=$s.ID;device=$s.DeviceObject;createdAt=[DateTime]::UtcNow.ToString('o');clientAccessible=$s.ClientAccessible;volume=$s.VolumeName} | ConvertTo-Json -Compress", {'CLICK360_ACQUIRE_VOLUME': drive})
        save(snapshot_file, snapshot)
    source_home = pathlib.Path(vss_source_home(snapshot.get('device'), user_home))
    # Copy only necessary storage containers. Shared LevelDB may contain other
    # origins/auth bytes and stays private locally; deliverables use the parser.
    roots = [('Chrome', source_home / 'AppData/Local/Google/Chrome/User Data'),
             ('Edge', source_home / 'AppData/Local/Microsoft/Edge/User Data')]
    allowed_origins = ('click-360.web.app', 'click-360.firebaseapp.com', 'roddysmith23-stack.github.io')
    manifest = []
    for browser, profile_root in roots:
        if not profile_root.exists():
            continue
        for profile in profile_root.iterdir():
            if not profile.is_dir() or not (profile.name == 'Default' or profile.name.startswith('Profile ')):
                continue
            selections = [profile / 'Local Storage/leveldb', profile / 'QuotaManager', profile / 'QuotaManager-wal',
                          profile / 'Service Worker/Database']
            indexed = profile / 'IndexedDB'
            if indexed.exists():
                selections += [p for p in indexed.iterdir() if any(origin in p.name for origin in allowed_origins)]
            # Resolve buckets by origin metadata; do not copy unrelated buckets.
            quota = profile / 'QuotaManager'
            if (profile / 'WebStorage').exists() and quota.exists():
                with sqlite3.connect(quota.as_uri() + '?mode=ro&immutable=1', uri=True) as connection:
                    columns = {row[1] for row in connection.execute('PRAGMA table_info(buckets)')}
                    if not {'id', 'storage_key'}.issubset(columns):
                        raise RuntimeError('UNKNOWN_BUCKET_SCHEMA_SOURCE_PRESERVED')
                    for bucket_id, origin in connection.execute('SELECT id, storage_key FROM buckets'):
                        if any(origin_name in origin for origin_name in allowed_origins):
                            selections.append(profile / 'WebStorage' / str(bucket_id))
            for selection in selections:
                if not selection.exists():
                    continue
                for source in regular_source_files(selection):
                    relative = pathlib.Path(browser) / profile.name / source.relative_to(profile)
                    target = raw / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    before = digest(source)
                    if not target.exists():
                        with source.open('rb') as src, target.open('xb') as dst:
                            shutil.copyfileobj(src, dst)
                    after = digest(target)
                    if before != after or digest(source) != before:
                        raise RuntimeError('SOURCE_COPY_HASH_MISMATCH')
                    manifest.append({'path': str(relative), 'bytes': source.stat().st_size,
                                     'sourceMtime': source.stat().st_mtime, 'sha256': before})
    if not manifest:
        raise RuntimeError('NO_CHROMIUM_PROFILE_FOUND_NO_APP_OPENED')
    safe = operation / 'PARA_ENTREGAR'
    safe.mkdir(exist_ok=True)
    if not (safe / 'commercial-data.json').exists():
        save(safe / 'commercial-data.json', parse_snapshot(raw, config))
    if not (safe / 'manifest.json').exists():
        save(safe / 'manifest.json', {'format': 'SHARY_PC_ACQUISITION_V1', 'operationId': config['operationId'],
                                    'snapshotId': snapshot['id'], 'snapshotAt': snapshot['createdAt'],
                                    'sourceConsistency': 'VSS_CRASH_CONSISTENT_NOT_RAM', 'files': manifest,
                                    'rawPrivateExcludedFromZip': True, 'cloudWrites': 0, 'browserStarted': False})
    result_zip = operation / 'SHARY_PARA_ENTREGAR.zip'
    if not result_zip.exists():
        with zipfile.ZipFile(result_zip, 'x', zipfile.ZIP_DEFLATED) as archive:
            for file in safe.iterdir():
                archive.write(file, file.name)
    save(operation / 'COMPLETE.json', {'zipSHA256': digest(result_zip), 'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                     'zip': result_zip.name, 'snapshotRetained': True})
    print('LISTO: SHARY_PARA_ENTREGAR.zip. NO envie RAW_PRIVADO_NO_ENVIAR. No abra ni recargue CLICK360 todavia.')


if __name__ == '__main__':
    try:
        acquire()
    except Exception as exc:
        safe_code = str(exc) if isinstance(exc, RuntimeError) and re.fullmatch(r'[A-Z0-9_]+', str(exc)) else type(exc).__name__
        print('ADQUISICION NO COMPLETADA: ' + safe_code + '. No limpie ni abra la app. Conserve la carpeta.')
        # Never print raw exception text: parsers may include source bytes.
        sys.exit(1)
