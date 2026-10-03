#!/usr/bin/env python3
"""Bounded metadata backup/restore. Secrets/config/live sessions are excluded."""
import argparse, os, pathlib, sqlite3, tempfile

def copy_metadata(source, destination, node):
    source=pathlib.Path(source).absolute(); destination=pathlib.Path(destination).absolute()
    if source.is_symlink() or not source.is_file(): raise ValueError('Invalid source database')
    if destination.is_symlink() or (destination.exists() and not destination.is_file()): raise ValueError('Invalid destination')
    if not destination.parent.is_dir() or destination.parent.is_symlink(): raise ValueError('Existing private destination directory required')
    if destination.parent.stat().st_mode & 0o077: raise ValueError('Destination directory must be owner-only')
    source_db=sqlite3.connect(f'file:{source}?mode=ro',uri=True)
    try:
        if source_db.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise ValueError('Source integrity failure')
        row=source_db.execute("SELECT value FROM metadata WHERE key='node_id'").fetchone()
        if row!=(node,): raise ValueError('Wrong target node identity')
        fd,temp=tempfile.mkstemp(prefix='.rdg-metadata-',dir=destination.parent)
        os.close(fd)
        try:
            target=sqlite3.connect(temp)
            try:
                source_db.backup(target)
                if target.execute('PRAGMA integrity_check').fetchone()[0]!='ok': raise ValueError('Backup integrity failure')
                target.commit()
            finally: target.close()
            os.chmod(temp,0o600)
            with open(temp,'rb') as stream: os.fsync(stream.fileno())
            if destination.is_symlink() or (destination.exists() and not destination.is_file()): raise ValueError('Destination changed')
            os.replace(temp,destination)
            fd=os.open(destination.parent,os.O_RDONLY)
            try: os.fsync(fd)
            finally: os.close(fd)
        finally:
            if os.path.exists(temp): os.unlink(temp)
    finally: source_db.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True);parser.add_argument('--output',required=True);parser.add_argument('--expected-node',required=True)
    args=parser.parse_args()
    try: copy_metadata(args.source,args.output,args.expected_node)
    except Exception: parser.exit(1,'Metadata operation refused: INVALID_SOURCE_OR_DESTINATION\n')
    print('Metadata copied and validated; live sessions and secrets were not restored.')
