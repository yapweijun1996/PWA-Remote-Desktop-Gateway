/** Validates metadata-only synthetic benchmark output and writes it atomically. */
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {writeArtifact} from '../scripts/atomic-artifact.mjs';

const [input,guacdImage,javaImage,sourceSnapshot,mode,qualitySnapshot]=process.argv.slice(2);
if(!input||[guacdImage,javaImage].some(value=>!/^sha256:[a-f0-9]{64}$/.test(value)))throw new Error('BENCHMARK_ARGUMENTS_INVALID');
const report=JSON.parse(await readFile(input,'utf8'));
if(!['full','candidate8','candidate16lossless','candidate8lossless'].includes(mode)||report.status!=='PASS'||report.scope!=='ISOLATED_OFFICIAL_GUACD_SYNTHETIC_BYTE_BENCHMARK'
    ||report.results?.length!==(mode==='full'?18:1))
  throw new Error('BENCHMARK_INCOMPLETE');
for(const row of report.results){
  if(row.status!=='PASS'||!['low','balanced','clear'].includes(row.profile)||row.framesReceived!==12||row.rfbFramesIncludingInitial!==13)
    throw new Error('BENCHMARK_ROW_INVALID');
  for(const key of ['guacamoleDownloadBytesAfterInitial','rfbDownloadBytesIncludingInitialAndHandshake','encodedImageBytesAfterInitial',
    'measuredDurationSeconds','firstFrameMs'])if(!Number.isFinite(row[key])||row[key]<=0)throw new Error('BENCHMARK_METRIC_INVALID');
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const productionPresetSourceSha256=hash(await readFile(qualitySnapshot));
if(mode==='full'&&productionPresetSourceSha256!==hash(await readFile('gateway/src/main/java/com/rdg/DisplayQuality.java')))
  throw new Error('PRODUCTION_PRESETS_CHANGED_DURING_BENCHMARK');
report.artifacts={guacdImage,javaImage,fixtureSourceSha256:hash(await readFile(sourceSnapshot)),productionPresetSourceSha256,immutableCompileSnapshot:true};
if(mode==='full'){
  if(report.presetSource!=='COMPILED_PRODUCTION_DISPLAY_QUALITY_SNAPSHOT')throw new Error('PRODUCTION_PRESET_OWNER_NOT_USED');
  for(const row of report.results){
    const expected=row.profile==='low'?{'color-depth':'16','force-lossless':'true'}:row.profile==='clear'?{'color-depth':'24','force-lossless':'true'}:{};
    if(JSON.stringify(Object.entries(row.settings).sort())!==JSON.stringify(Object.entries(expected).sort()))throw new Error('PRODUCTION_PRESET_MISMATCH');
  }
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
report.summary=[];
if(mode==='full')for(const capability of ['RAW_ONLY','ZLIB_RAW']){
  const balancedRows=report.results.filter(row=>row.targetCapabilities===capability&&row.profile==='balanced');
  const baseline=median(balancedRows.map(row=>row.guacamoleDownloadBytesAfterInitial));
  for(const profile of ['low','balanced','clear']){
    const rows=report.results.filter(row=>row.targetCapabilities===capability&&row.profile===profile);
    if(rows.length!==3||new Set(rows.map(row=>row.repeat)).size!==3)throw new Error('BENCHMARK_REPEATS_INVALID');
    const bytes=median(rows.map(row=>row.guacamoleDownloadBytesAfterInitial));
    report.summary.push({profile,targetCapabilities:capability,negotiatedEncoding:rows[0].negotiatedEncoding,
      medianGuacamoleDownloadBytes:bytes,medianImageBytes:median(rows.map(row=>row.encodedImageBytesAfterInitial)),
      medianRfbDownloadBytes:median(rows.map(row=>row.rfbDownloadBytesIncludingInitialAndHandshake)),
      changeFromBalancedPercent:(bytes/baseline-1)*100,
      medianSyntheticPointerToFrameSyncMs:median(rows.flatMap(row=>row.syntheticPointerToFrameSyncMs.samples)),
      medianFirstFrameMs:median(rows.map(row=>row.firstFrameMs))});
  }
}
await mkdir('qa/implementation/bandwidth-20261004',{recursive:true});
const reportNames={full:'synthetic-benchmark',candidate8:'candidate-8',candidate16lossless:'candidate-16-lossless',candidate8lossless:'candidate-8-lossless'};
await writeArtifact(`qa/implementation/bandwidth-20261004/${reportNames[mode]}.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,scope:report.scope,runs:report.results.length,
  ...(mode!=='full'?{candidate:report.results[0]}:{summary:report.summary})}));
