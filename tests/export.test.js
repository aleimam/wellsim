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
  assert.equal(exporter.workbookSchemaId, 'wellsim.case-workbook.v1');
  assert.deepEqual(exporter.workbookCapability, {
    id: 'case-xlsx',
    label: 'Engineering case workbook (Excel)',
    extension: 'xlsx',
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dataTypes: ['case'],
    roundTrip: false,
    execution: 'queued',
    modelSchemaId: 'wellsim.case-workbook.v1',
    description: 'Versioned inputs, selections, tabular datasets and provenance. Requires an approved server-side renderer.',
  });
  assert.deepEqual(exporter.formatsFor('case').map((format) => format.id), ['case-json', 'case-inputs-csv']);
  assert.equal(exporter.formats.find((format) => format.id === 'case-json').roundTrip, true);
  assert.ok(Object.isFrozen(exporter));
  assert.ok(Object.isFrozen(exporter.formats));
});

test('Excel workbook model is versioned, tabular and keeps JSON as the round-trip format', () => {
  const model = exporter.createWorkbookModel(CASE, {
    generatedAt: '2026-09-02T01:00:00.000Z',
    deploymentRevision: 'test-revision',
    sourceChecksum: 'abc123',
    fieldMeta: { 'oil-thpPsi': { label: 'FTHP', unit: 'psi', section: 'oil' } },
    gridMeta: { oilProd: { rate: { label: 'Oil rate', unit: 'STB/d', valueType: 'number' } } },
  });

  assert.equal(model.workbookSchemaId, 'wellsim.case-workbook.v1');
  assert.deepEqual(model.sheets.map((sheet) => sheet.name), [
    'Summary', 'Inputs', 'Selections', 'Oil Prod', 'Manifest',
  ]);
  assert.equal(model.sheets.find((sheet) => sheet.id === 'inputs').rows[1][2], 'FTHP');
  assert.equal(model.sheets.find((sheet) => sheet.id === 'inputs').rows[1][3], 700);
  assert.deepEqual(model.sheets.find((sheet) => sheet.id === 'grid-oilProd').rows, [
    [1, '2026-09-01', 2100],
  ]);
  assert.equal(model.sheets.find((sheet) => sheet.id === 'grid-oilProd').columns[2].label, 'Oil rate (STB/d)');
  assert.match(
    model.sheets.find((sheet) => sheet.id === 'summary').rows.at(-1)[1],
    /use the WellSim JSON export/,
  );
  assert.deepEqual(
    model.sheets.find((sheet) => sheet.id === 'manifest').rows.slice(-4),
    [['round_trip', 'false'], ['formula_policy', 'none'], ['external_links', 'none'], ['macros', 'none']],
  );
  assert.ok(Object.isFrozen(model));
  assert.ok(Object.isFrozen(model.sheets));
});

test('workbook model produces safe unique sheet names and neutralizes formulas', () => {
  const model = exporter.createWorkbookModel({
    ...CASE,
    inputs: { '=formula': '=1+1' },
    computed: [],
    selects: {},
    radios: {},
    grids: {
      'same/name': [{ value: '+danger' }],
      'same:name': [{ value: '-12.5' }],
    },
  }, { generatedAt: '2026-09-02T01:00:00.000Z' });

  assert.deepEqual(model.sheets.find((sheet) => sheet.id === 'inputs').rows[0].slice(1, 4), [
    "'=formula", "'=Formula", "'=1+1",
  ]);
  assert.deepEqual(
    model.sheets.filter((sheet) => sheet.id.startsWith('grid-')).map((sheet) => sheet.name),
    ['Same-Name', 'Same-Name 2'],
  );
  assert.equal(model.sheets.find((sheet) => sheet.id === 'grid-same/name').rows[0][1], "'+danger");
  assert.equal(model.sheets.find((sheet) => sheet.id === 'grid-same:name').rows[0][1], -12.5);
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
