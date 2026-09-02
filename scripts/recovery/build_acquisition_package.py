"""Build an offline Windows x64 acquisition ZIP. No customer payload embedded."""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import urllib.request
import zipfile

BASE = pathlib.Path(__file__).resolve().parent
PYTHON_URL = 'https://www.python.org/ftp/python/3.13.14/python-3.13.14-embed-amd64.zip'
PYTHON_HASH = '90b4e5b9898b72d744650524bff92377c367f44bd5fbd09e3148656c080ad907'
WHEELS = ['dfindexeddb==20260210', 'python-snappy==0.7.3', 'cramjam==2.12.1', 'zstd==1.5.7.2']
WHEEL_HASHES = {
    'dfindexeddb-20260210-py3-none-any.whl': 'c037eb764b8bc437e2052d9d54952de1ef97aec4c81d5676b490a2901fdf4290',
    'python_snappy-0.7.3-py3-none-any.whl': '074c0636cfcd97e7251330f428064050ac81a52c62ed884fc2ddebbb60ed7f50',
    'cramjam-2.12.1-cp313-cp313-win_amd64.whl': '8e6e9ee3086c5c0b0ef7595e39962e55c1a8b562af54bfc00c274f5ee41d8fa7',
    'zstd-1.5.7.2-cp313-cp313-win_amd64.whl': 'eea9bddf06f3f5e1e450fd647665c86df048a45e8b956d53522387c1dff41b7a',
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_extract(archive, destination):
    root = destination.resolve()
    for member in archive.infolist():
        target = (destination / member.filename).resolve()
        if root not in target.parents and target != root:
            raise RuntimeError('ARCHIVE_PATH_TRAVERSAL_BLOCKED')
        # Unix symlink mode embedded in a ZIP is never needed by this package.
        if (member.external_attr >> 16) & 0o170000 == 0o120000:
            raise RuntimeError('ARCHIVE_SYMLINK_BLOCKED')
    archive.extractall(destination)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    output = pathlib.Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    stage = output / 'SHARY_PC_ACQUISITION_PACKAGE'
    stage.mkdir()
    runtime = stage / 'runtime'
    runtime.mkdir()
    downloads = output / 'downloads'
    downloads.mkdir()
    archive = downloads / 'python-embed.zip'
    urllib.request.urlretrieve(PYTHON_URL, archive)
    if sha(archive) != PYTHON_HASH:
        raise RuntimeError('OFFICIAL_PYTHON_HASH_MISMATCH')
    with zipfile.ZipFile(archive) as reader:
        safe_extract(reader, runtime)
    subprocess.run([sys.executable, '-m', 'pip', 'download', '--dest', str(downloads),
                    '--platform', 'win_amd64', '--python-version', '313', '--implementation', 'cp',
                    '--abi', 'cp313', '--only-binary=:all:', '--no-deps', *WHEELS], check=True)
    wheel_files = {wheel.name: wheel for wheel in downloads.glob('*.whl')}
    if set(wheel_files) != set(WHEEL_HASHES):
        raise RuntimeError('DEPENDENCY_SET_MISMATCH')
    for name, wheel in sorted(wheel_files.items()):
        if sha(wheel) != WHEEL_HASHES[name]:
            raise RuntimeError('DEPENDENCY_HASH_MISMATCH_' + name)
        with zipfile.ZipFile(wheel) as reader:
            safe_extract(reader, runtime)
    # Isolated embedded runtime imports only stdlib, its vendored modules and
    # this signed/hash-listed package directory. No user site or PYTHONPATH.
    (runtime / 'python313._pth').write_text('python313.zip\n.\n..\n', encoding='ascii')
    for name in ('acquire_windows.py', 'parse_client.py', 'test_acquisition.py'):
        shutil.copyfile(BASE / name, stage / name)
    config = json.loads(pathlib.Path(args.config).read_text(encoding='utf8'))
    for key in ('ownerUid', 'businessId', 'tenantKey', 'origins', 'operationId'):
        if key not in config:
            raise RuntimeError('MISSING_CONFIG_' + key)
    (stage / 'tenant-config.json').write_text(json.dumps(config, indent=2), encoding='utf8')
    (stage / 'INICIAR_RECUPERACION.cmd').write_bytes(b'@echo off\r\n"%~dp0runtime\\python.exe" "%~dp0acquire_windows.py"\r\npause\r\n')
    (stage / 'LEEME.txt').write_text(
        'SHARY: no abra, recargue, cierre sesion ni limpie CLICK360.\n'
        'Extraiga este ZIP en el PC usado para CLICK360. Ejecute INICIAR_RECUPERACION.cmd '
        'y acepte el aviso normal de Windows para la copia de seguridad.\n'
        'No desactive antivirus ni politicas de Windows si lo bloquean.\n'
        'Al terminar, entregue solamente Desktop/SHARY_PC_ACQUISITION/<operacion>/SHARY_PARA_ENTREGAR.zip.\n'
        'RAW_PRIVADO_NO_ENVIAR permanece en su PC. No enviar esa carpeta.\n'
        'El programa no abre la app, no usa Internet y no cambia datos CLICK360. '
        'Crea una instantanea VSS local (no captura cambios solo en RAM) y conserva la evidencia.\n'
        'Una segunda ejecucion no sustituye una adquisicion terminada.\n'
        'Windows 10/11 x64; Chrome/Edge. Si el navegador o formato no es compatible, no se declara recuperacion.\n', encoding='utf8')
    manifest = {'python': {'url': PYTHON_URL, 'sha256': PYTHON_HASH},
                'dependencies': [{'file': p.name, 'sha256': sha(p)} for p in downloads.glob('*.whl')],
                'files': [{'path': str(p.relative_to(stage)), 'sha256': sha(p)} for p in sorted(stage.rglob('*')) if p.is_file()]}
    (stage / 'PACKAGE_HASHES.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
    dest = output / 'SHARY_PC_ACQUISITION_PACKAGE.zip'
    with zipfile.ZipFile(dest, 'x', zipfile.ZIP_DEFLATED) as writer:
        for file in sorted(stage.rglob('*')):
            if file.is_file():
                writer.write(file, str(file.relative_to(output)))
    (output / 'PACKAGE_SHA256.txt').write_text(sha(dest) + '  ' + dest.name + '\n', encoding='ascii')
    print(json.dumps({'package': str(dest), 'sha256': sha(dest), 'customerPayloadEmbedded': False}))


if __name__ == '__main__':
    main()
