import importlib.util,pathlib,sqlite3,tempfile,unittest,os
spec=importlib.util.spec_from_file_location('backup',pathlib.Path(__file__).resolve().parents[1]/'scripts/metadata-backup.py');backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)
class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.source=self.root/'source.sqlite';db=sqlite3.connect(self.source);db.execute('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT)');db.execute("INSERT INTO metadata VALUES('node_id','fixture-node')");db.execute('CREATE TABLE audit(id TEXT)');db.execute("INSERT INTO audit VALUES('test-audit')");db.commit();db.close()
    def tearDown(self): self.temp.cleanup()
    def test_backup_restore_and_permissions(self):
        output=self.root/'backup.sqlite';restore=self.root/'restore.sqlite';backup.copy_metadata(self.source,output,'fixture-node');backup.copy_metadata(output,restore,'fixture-node');self.assertEqual(output.stat().st_mode&0o777,0o600);self.assertEqual(sqlite3.connect(restore).execute('SELECT id FROM audit').fetchall(),[('test-audit',)]);self.assertEqual(list(self.root.glob('.rdg-metadata-*')),[])
    def test_wrong_node_preserves_destination(self):
        output=self.root/'backup.sqlite';output.write_bytes(b'preserved');self.assertRaises(ValueError,backup.copy_metadata,self.source,output,'other-node');self.assertEqual(output.read_bytes(),b'preserved')
    def test_symlink_target_and_unsafe_directory_refused(self):
        protected=self.root/'protected';protected.write_bytes(b'preserved');link=self.root/'link';link.symlink_to(protected);self.assertRaises(ValueError,backup.copy_metadata,self.source,link,'fixture-node');self.assertEqual(protected.read_bytes(),b'preserved');os.chmod(self.root,0o755);self.assertRaises(ValueError,backup.copy_metadata,self.source,self.root/'backup','fixture-node')
if __name__=='__main__':unittest.main()
