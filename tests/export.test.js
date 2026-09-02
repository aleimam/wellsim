import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/ui/export.js');

const exporter = globalThis.WellSimExport;
const CASE = {
  app: 'WellSim',
  version: 1,
  savedAt: '2026-09-02T00:00:00.000Z',
  activeTab: 'oil',
  inputs: { 'oil-thpPsi': '700', 'oil-note': 'normal text' },
  computed: ['oil-prPsi'],
  radios: { 'oil-lift': 'natural' },
  selects: { 'oil-pump': 'Demo pump' },
  grids: { oilProd: [{ date: '2026-09-01', rate: '2100' }] },
};

test('export registry declares versioned case capabilities', () => {
  assert.equal(exporter.contractVersion, 1);
  assert.equal(exporter.caseSchemaId, 'wellsim.case.v1');
  assert.deepEqual(exporter.formatsFor('case').map((format) => format.id), ['case-json', 'case-inputs-csv']);
  assert.equal(exporter.formats.find((format) => format.id === 'case-json').roundTrip, true);
  assert.ok(Object.isFrozen(exporter));
  assert.ok(Object.isFrozen(exporter.formats));
});

test('JSON export is a restorable WellSim case with a safe filename', () => {
  const artifact = exporter.createArtifact(CASE, 'case-json', { baseName: '../../Well A:12.json' });
  assert.equal(artifact.filename, 'Well A-12.json');
  assert.equal(artifact.mediaType, 'application/vnd.wellsim.case+json');
  assert.equal(artifact.roundTrip, true);
  assert.deepEqual(JSON.parse(artifact.content), CASE);
});

test('CSV export is stable, labelled, UTF-8 and spreadsheet-ready', () => {
  const artifact = exporter.createArtifact(CASE, 'case-inputs-csv', {
    baseName: 'Well A inputs',
    fieldMeta: { 'oil-thpPsi': { label: 'FTHP', unit: 'psi', section: 'oil' } },
  });
  assert.equal(artifact.filename, 'Well A inputs.csv');
  assert.equal(artifact.roundTrip, false);
  assert.ok(artifact.content.startsWith('\uFEFF"record_type","section","row","field","label","unit","value"\r\n'));
  assert.match(artifact.content, /"input","oil","","oil-thpPsi","FTHP","psi","700"/);
  assert.match(artifact.content, /"grid","oilProd","1","rate","rate","","2100"/);
  assert.match(artifact.content, /"computed","oil","","oil-prPsi","oil-prPsi","","calculated by WellSim"/);
});

test('CSV export neutralizes formulas without converting negative numbers to text', () => {
  const hostile = {
    ...CASE,
    inputs: {
      formula: '=1+1',
      command: '-cmd|calc',
      mention: '@SUM(A1:A2)',
      leading: '  +danger',
      negative: '-12.5',
    },
  };
  const csv = exporter.createArtifact(hostile, 'case-inputs-csv').content;
  assert.match(csv, /"'=1\+1"/);
  assert.match(csv, /"'-cmd\|calc"/);
  assert.match(csv, /"'@SUM\(A1:A2\)"/);
  assert.match(csv, /"'  \+danger"/);
  assert.match(csv, /"-12\.5"/);
  assert.doesNotMatch(csv, /"'-12\.5"/);
});

test('export rejects unknown case versions and formats', () => {
  assert.throws(() => exporter.createArtifact({ ...CASE, version: 99 }, 'case-json'), /unsupported WellSim case version/);
  assert.throws(() => exporter.createArtifact(CASE, 'case-pdf'), /unsupported case export format/);
  assert.throws(() => exporter.createArtifact({ ...CASE, app: 'Other' }, 'case-json'), /not a WellSim case/);
});
