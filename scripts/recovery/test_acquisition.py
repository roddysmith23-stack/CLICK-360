"""Synthetic, cross-platform acquisition parser regression; no real profile."""
import dataclasses
import hashlib
import json
import io
import pathlib
import struct
import tempfile
import unittest

from parse_client import parse_snapshot, plain, sanitize, identity_conflict
from acquire_windows import vss_source_home, regular_source_files


def varint(number):
    result = bytearray()
    while number >= 128:
        result.append((number & 127) | 128)
        number >>= 7
    result.append(number)
    return bytes(result)


def leveldb_log(entries):
    batch = struct.pack('<QI', 17, len(entries))
    for key, value in entries:
        batch += b'\x01' + varint(len(key)) + key + varint(len(value)) + value
    crc = 0xffffffff
    for byte in b'\x01' + batch:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0x82f63b78 if crc & 1 else 0)
    crc ^= 0xffffffff
    masked = (((crc >> 15) | (crc << 17)) + 0xa282ead8) & 0xffffffff
    return struct.pack('<IHB', masked, len(batch), 1) + batch


class AcquisitionTests(unittest.TestCase):
    def test_vss_namespace_never_falls_back_to_live_profile(self):
        device = r'\\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy42'
        result = vss_source_home(device, r'C:\Users\Synthetic')
        self.assertEqual(str(result), device + r'\Users\Synthetic')
        for invalid in [r'C:\Users\Synthetic', device + r'\..\live', r'\\\\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy42', None]:
            with self.assertRaisesRegex(RuntimeError, 'NOT_A_VSS_SOURCE'):
                vss_source_home(invalid, r'C:\Users\Synthetic')

    def test_source_selection_is_regular_files_only(self):
        with tempfile.TemporaryDirectory(prefix='click360-selection-') as temp:
            root=pathlib.Path(temp).resolve(); (root/'nested').mkdir()
            (root/'a').write_bytes(b'synthetic'); (root/'nested'/'b').write_bytes(b'synthetic')
            self.assertEqual(sorted(p.relative_to(root).as_posix() for p in regular_source_files(root)), ['a','nested/b'])

    def test_allowlist_versions_credentials_and_unchanged_source(self):
        owner = 'synthetic_owner'
        tenant = 'owner:synthetic_owner:business:synthetic_business'
        config = {'ownerUid': owner, 'businessId': 'synthetic_business', 'tenantKey': tenant,
                  'origins': ['https://synthetic.invalid']}
        state = {'identity': {'ownerId': owner, 'businessId': config['businessId'], 'tenantKey': tenant},
                 'products': [{'id': 'synthetic-p1', 'stock': 17, 'qty': 17}],
                 'sales': [], 'password': 'DO_NOT_EXPORT', 'nested': {'refreshToken': 'DO_NOT_EXPORT'}}
        prefix = b'_https://synthetic.invalid\0\x01'
        key = prefix + ('CLICK360:V16:STATE:' + owner + ':' + tenant).encode()
        raw = leveldb_log([(key, b'\x01' + json.dumps(state).encode()),
                           (prefix + b'firebase:authUser:synthetic', b'\x01DO_NOT_EXPORT'),
                           (key, b'\x01' + json.dumps(state | {'pendingRemoteSync': True}).encode())])
        with tempfile.TemporaryDirectory(prefix='click360-synthetic-acquire-') as temp:
            folder = pathlib.Path(temp) / 'Chrome/Default/Local Storage/leveldb'
            folder.mkdir(parents=True)
            source = folder / '000001.log'
            source.write_bytes(raw)
            before = hashlib.sha256(raw).hexdigest()
            result = parse_snapshot(temp, config)
            self.assertEqual(len(result['records']), 2)
            self.assertNotIn('DO_NOT_EXPORT', json.dumps(result))
            self.assertEqual(result['records'][0]['value']['products'][0]['qty'], 17)
            self.assertTrue(all(not r['serverCommitted'] for r in result['records']))
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)
            self.assertEqual(result, parse_snapshot(temp, config))

    def test_nested_dataclasses_do_not_lose_array_semantics(self):
        from dfindexeddb.indexeddb.types import JSArray
        @dataclasses.dataclass
        class Container:
            value: object
        self.assertEqual(plain(Container({'products': JSArray(values=[{'id': 'p'}])})), {'value': {'products': [{'id': 'p'}]}})

    def test_identity_and_redaction_fail_closed(self):
        self.assertTrue(identity_conflict({'products': [{'businessId': 'other'}]}, {'businessId': 'synthetic', 'tenantKey': 't', 'ownerUid': 'u'}))
        self.assertEqual(sanitize({'cookie': 'secret', 'name': 'Producto', 'nested': {'access_token': 'secret'}}), {'name': 'Producto', 'nested': {}})
        self.assertNotIn('secret', sanitize('{"nested":{"password":"secret"},"name":"Producto"}'))
        self.assertNotIn('secret', sanitize('https://synthetic.invalid/?access_token=secret&name=ok'))
        self.assertTrue(identity_conflict({'ownerUid': 'other'}, {'ownerUid': 'synthetic', 'businessId': 'synthetic', 'tenantKey': 't'}))

    def test_v16_binary_and_future_versions_are_not_guessed(self):
        from dfindexeddb.indexeddb.chromium import v8
        with tempfile.TemporaryDirectory(prefix='click360-parser-config-') as temp:
            parse_snapshot(temp, {'ownerUid':'synthetic','businessId':'synthetic','tenantKey':'t','origins':[]})
        decoder=v8.ValueDeserializer(io.BytesIO(b'\xff\x10B\x01x'), None)
        self.assertTrue(decoder.ReadHeader())
        with self.assertRaisesRegex(ValueError, 'V16_BINARY_NOT_SUPPORTED'):
            decoder.ReadValue()
        future=v8.ValueDeserializer(io.BytesIO(b'\xff\x11'), None)
        self.assertFalse(future.ReadHeader())

    def test_proven_logical_business_is_not_misclassified_as_other_tenant(self):
        config={'ownerUid':'owner','businessId':'owner','tenantKey':'owner:owner:business:owner','logicalBusinessIds':['legacy-business']}
        state={'identity':{'ownerUid':'owner','ownerId':'owner','businessId':'owner','tenantKey':config['tenantKey']},'products':[{'businessId':'legacy-business'}]}
        self.assertFalse(identity_conflict(state,config))
        self.assertTrue(identity_conflict({'products':[{'businessId':'unrelated'}]},config))
        self.assertTrue(identity_conflict({'identity':{'businessId':'legacy-business'}},config))


if __name__ == '__main__':
    unittest.main()
