"""Offline, allowlisted CLICK360 acquisition parser. Never starts a DB/browser.

Physical versions are retained separately. A cache entry is NOT evidence of a
server commit. Unknown formats fail coverage rather than being silently lost.
"""
import contextlib
import dataclasses
import hashlib
import io
import json
import pathlib
import re
import sys

ALLOW = ('CLICK360:V16:STATE:', 'CLICK360_STATE:', 'CLICK360_BACKUP:',
         'CLICK360:V16:CACHEMETA:', 'CLICK360_TENANT:',
         'CLICK360:V16:QUARANTINE:', 'CLICK360:V10:QUARANTINE:',
         'CLICK360_QUARANTINED:', 'CLICK360_QUARANTINE:',
         'CLICK360_LEGACY_QUARANTINED:', 'CLICK360:P1_5C:PRINT_DEVICE:',
         'CLICK360:V16:PRINTING:')
STORES = {'tenantSnapshots', 'remoteDocuments', 'remoteDocumentsV14',
          'mutations', 'documentMutations', 'documentOverlays'}
SECRET = re.compile(r'password|passwd|token|cookie|credential|authorization|private.?key|firebase.?auth|stsToken', re.I)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def plain(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if dataclasses.is_dataclass(value):
        data = {field.name: getattr(value, field.name) for field in dataclasses.fields(value)}
        if type(value).__name__ == 'JSObject':
            return plain(data.get('properties', data))
        if type(value).__name__ == 'JSArray':
            return plain(data.get('values', data))
        if type(value).__name__ == 'Null':
            return None
        return plain(data)
    if isinstance(value, bytes):
        return {'unparsedBytes': len(value), 'sha256': sha(value)}
    raise ValueError('UNSUPPORTED_VALUE_TYPE_' + type(value).__name__)


def sanitize(value):
    if isinstance(value, dict):
        return {k: sanitize(v) for k, v in value.items() if not SECRET.search(k)}
    if isinstance(value, list):
        return [sanitize(v) for v in value]
    if isinstance(value, str) and value.lstrip().startswith(('{', '[')):
        try:
            return json.dumps(sanitize(json.loads(value)), ensure_ascii=True)
        except (ValueError, RecursionError):
            return '[REDACTED_UNPARSED_EMBEDDED_JSON]'
    if isinstance(value, str) and (re.search(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.', value)
                                   or re.search(r'(?i)bearer\s+[a-z0-9_.-]+', value)):
        return '[REDACTED_CREDENTIAL_PATTERN]'
    if isinstance(value, str):
        return re.sub(r'(?i)([?&](?:access_token|refresh_token|token|password|code|key)=)[^&\s]*', r'\1[REDACTED]', value)
    return value


def chrome_string(data):
    if not data:
        return ''
    if data[0] == 0:
        return data[1:].decode('utf-16-le')
    if data[0] == 1:
        return data[1:].decode('latin1')
    raise ValueError('UNKNOWN_LOCALSTORAGE_ENCODING')


def identity_conflict(value, config):
    if isinstance(value, list):
        return any(identity_conflict(v, config) for v in value)
    if not isinstance(value, dict):
        return False
    # Entity IDs/worker actors are not tenant identity. Only explicit tenant fields.
    # Legacy tenants can have a logical business ID distinct from the owner's
    # state document ID. Both are explicit acquisition scope, never inferred
    # from arbitrary records encountered in a shared browser profile.
    allowed_businesses = {config['businessId'], *config.get('logicalBusinessIds', [])}
    if 'businessId' in value and value['businessId'] not in (None, '') and value['businessId'] not in allowed_businesses:
        return True
    if 'tenantKey' in value and value['tenantKey'] not in (None, '', config['tenantKey']):
        return True
    if 'ownerUid' in value and value['ownerUid'] not in (None, '', config['ownerUid']):
        return True
    ident = value.get('identity')
    if isinstance(ident, dict):
        for key in ('ownerId', 'ownerUid'):
            if ident.get(key) not in (None, '', config['ownerUid']):
                return True
        if ident.get('businessId') not in (None, '', config['businessId']):
            return True
    return any(identity_conflict(v, config) for v in value.values())


def parse_snapshot(root, config):
    from dfindexeddb.leveldb import record
    from dfindexeddb.indexeddb.chromium import record as idb
    from dfindexeddb.indexeddb.chromium import v8
    # V8 format 16 changes ONLY ArrayBuffer/View lengths to size_t. CLICK360
    # JSON state uses neither. Admit the unchanged JSON subset, explicitly deny
    # v16 binary objects instead of pretending the v15 decoder supports them.
    # Source: v8 commit 3f4cb1dd32849258430f6b60da620141dcc42400.
    if v8.ValueDeserializer.LATEST_VERSION == 15:
        original = v8.ValueDeserializer
        class CommercialJsonDeserializer(original):
            LATEST_VERSION = 16
            def _ReadJSArrayBuffer(self, is_shared, is_resizable):
                if self.version >= 16:
                    raise ValueError('V16_BINARY_NOT_SUPPORTED_PRESERVED_RAW')
                return super()._ReadJSArrayBuffer(is_shared, is_resizable)
            def _ReadJSArrayBufferView(self, buffer):
                if self.version >= 16:
                    raise ValueError('V16_BINARY_VIEW_NOT_SUPPORTED_PRESERVED_RAW')
                return super()._ReadJSArrayBufferView(buffer)
        v8.ValueDeserializer = CommercialJsonDeserializer
    root = pathlib.Path(root)
    records, errors, metadata = [], [], []
    needles = [config['ownerUid'].encode(enc) for enc in ('utf8', 'utf-16-le', 'utf-16-be')]
    origins = set(config['origins'])

    def error(path, code):
        errors.append({'source': str(path.relative_to(root)), 'code': code})

    def emit(path, rec, kind, key, value):
        value = plain(value)
        if identity_conflict(value, config):
            error(path, 'OTHER_TENANT_IDENTITY_EXCLUDED')
            return
        safe = sanitize(value)
        records.append({'source': str(path.relative_to(root)), 'kind': kind,
                        'key': sanitize(key), 'sequence': getattr(rec.record, 'sequence_number', None),
                        'recordType': str(getattr(rec.record, 'record_type', 'unknown')),
                        'rawValueHash': sha(bytes(rec.record.value)), 'value': safe,
                        'classification': 'LOCAL-PENDING' if kind in ('mutations', 'documentOverlays')
                        or (isinstance(value, dict) and (value.get('pendingRemoteSync') is True
                            or isinstance(value.get('value'), dict) and value['value'].get('pendingRemoteSync') is True)) else 'UNKNOWN',
                        'serverCommitted': False})

    for folder in sorted(root.rglob('leveldb')):
        if folder.parent.name != 'Local Storage':
            continue
        for file in sorted(folder.iterdir()):
            if file.suffix not in ('.log', '.ldb', '.sst'):
                continue
            try:
                with contextlib.redirect_stderr(io.StringIO()):
                    for rec in record.LevelDBRecord.FromFile(file):
                        key = bytes(rec.record.key)
                        if not key.startswith(b'_') or b'\0' not in key:
                            continue
                        origin, name_raw = key[1:].split(b'\0', 1)
                        if origin.decode('utf8', 'replace') not in origins:
                            continue
                        name = chrome_string(name_raw)
                        if not name.startswith(ALLOW) or SECRET.search(name):
                            continue
                        if config['ownerUid'] not in name and config['tenantKey'] not in name:
                            continue
                        raw = bytes(rec.record.value)
                        if not raw:  # Preserve tombstone metadata without inventing a value.
                            emit(file, rec, 'localStorage', name, None)
                            continue
                        try:
                            emit(file, rec, 'localStorage', name, json.loads(chrome_string(raw)))
                        except Exception as exc:
                            error(file, type(exc).__name__ + '_COMMERCIAL_VALUE_UNPARSED')
            except Exception as exc:
                error(file, type(exc).__name__ + '_LEVELDB_UNPARSED')

    for folder in sorted(root.rglob('*.indexeddb.leveldb')):
        dbs, stores = {}, {}
        files = [p for p in folder.iterdir() if p.suffix in ('.log', '.ldb', '.sst')]
        # Metadata pass never decodes Firebase Auth values.
        for file in files:
            try:
                with contextlib.redirect_stderr(io.StringIO()):
                    for rec in record.LevelDBRecord.FromFile(file):
                        try:
                            key = idb.IndexedDbKey.FromBytes(rec.record.key)
                            if key.key_prefix.object_store_id != 0:
                                continue
                            if isinstance(key, idb.DatabaseNameKey) and rec.record.value:
                                dbs[int(key.ParseValue(rec.record.value))] = key.database_name
                            elif isinstance(key, idb.DatabaseMetaDataKey) and getattr(key.metadata_type, 'name', '') == 'DATABASE_NAME':
                                dbs[key.key_prefix.database_id] = key.ParseValue(rec.record.value)
                            elif isinstance(key, idb.ObjectStoreMetaDataKey) and getattr(key.metadata_type, 'name', '') == 'OBJECT_STORE_NAME':
                                stores[(key.key_prefix.database_id, key.object_store_id)] = key.ParseValue(rec.record.value)
                        except Exception:
                            continue  # Non-metadata row; parsed in the allowlisted pass below.
            except Exception as exc:
                error(file, type(exc).__name__ + '_METADATA_UNPARSED')
        targets = {k for k, v in dbs.items() if v == 'CLICK360_V16_DB' or v == 'firestore/[DEFAULT]/click-360/main'}
        metadata.append({'source': str(folder.relative_to(root)), 'commercialDatabaseCount': len(targets),
                         'stores': sorted({v for k, v in stores.items() if k[0] in targets and v in STORES})})
        blob_path = folder.with_suffix('.blob')
        blob_reader = idb.BlobFolderReader(blob_path) if blob_path.exists() else None
        for file in files:
            try:
                with contextlib.redirect_stderr(io.StringIO()):
                    for rec in record.LevelDBRecord.FromFile(file):
                        try:
                            key = idb.IndexedDbKey.FromBytes(rec.record.key)
                            prefix = key.key_prefix
                            store = stores.get((prefix.database_id, prefix.object_store_id))
                            if prefix.database_id not in targets or store not in STORES:
                                continue
                            if not isinstance(key, (idb.ObjectStoreDataKey, idb.BlobEntryKey)):
                                continue
                            if not any(n in rec.record.key or n in rec.record.value for n in needles):
                                continue
                            key_text = str(key)
                            if store.startswith('remoteDocument') and not ('businesses' in key_text and ('state' in key_text or 'businessUnits' in key_text)):
                                continue
                            parsed = idb.ChromiumIndexedDBRecord.FromLevelDBRecord(rec, blob_folder_reader=blob_reader)
                            emit(file, rec, store, key_text, {'value': parsed.value, 'blobs': parsed.blobs})
                        except Exception as exc:
                            error(file, type(exc).__name__ + '_IDB_COMMERCIAL_UNPARSED')
            except Exception as exc:
                error(file, type(exc).__name__ + '_IDB_FILE_UNPARSED')

    # New Chromium SQLite stores and Firefox are preserved, never silently certified.
    for file in root.rglob('*.sqlite'):
        error(file, 'SQLITE_PRESERVED_REQUIRES_FORMAT_PARSER')
    return {'format': 'CLICK360_CLIENT_ACQUISITION_V1', 'records': records,
            'metadata': metadata, 'errors': errors,
            'coverage': 'PARTIAL' if errors else 'PARSED_AVAILABLE_ALLOWLIST',
            'sourceIsServerProof': False, 'browserStarted': False, 'cloudWrites': 0}


if __name__ == '__main__':
    source, config_file, output = sys.argv[1:]
    result = parse_snapshot(source, json.loads(pathlib.Path(config_file).read_text(encoding='utf8')))
    pathlib.Path(output).write_text(json.dumps(result, ensure_ascii=True, indent=2), encoding='utf8')
