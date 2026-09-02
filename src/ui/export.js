/* WellSim browser export contract.
 *
 * Deliberately dependency-free and exposed through one frozen global so the
 * website and the portable build use the same exporters. New modules register
 * formats here instead of inventing their own download and filename rules.
 */
(function installWellSimExport(root) {
  'use strict';

  const CONTRACT_VERSION = 1;
  const CASE_SCHEMA_ID = 'wellsim.case.v1';
  const WORKBOOK_SCHEMA_ID = 'wellsim.case-workbook.v1';
  const WORKBOOK_CAPABILITY = Object.freeze({
    id: 'case-xlsx',
    label: 'Engineering case workbook (Excel)',
    extension: 'xlsx',
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dataTypes: Object.freeze(['case']),
    roundTrip: false,
    execution: 'queued',
    modelSchemaId: WORKBOOK_SCHEMA_ID,
    description: 'Versioned inputs, selections, tabular datasets and provenance. Requires an approved server-side renderer.',
  });

  const FORMATS = Object.freeze([
    Object.freeze({
      id: 'case-json',
      label: 'WellSim case (JSON)',
      extension: 'json',
      mediaType: 'application/vnd.wellsim.case+json',
      dataTypes: Object.freeze(['case']),
      roundTrip: true,
      description: 'Complete current case. This file can be opened in WellSim.',
    }),
    Object.freeze({
      id: 'case-inputs-csv',
      label: 'Case inputs (CSV)',
      extension: 'csv',
      mediaType: 'text/csv;charset=utf-8',
      dataTypes: Object.freeze(['case']),
      roundTrip: false,
      description: 'Spreadsheet-ready inputs and imported production rows. CSV is not a restorable case.',
    }),
  ]);

  const byId = new Map(FORMATS.map((format) => [format.id, format]));

  function assertCase(caseData) {
    if (!caseData || typeof caseData !== 'object' || Array.isArray(caseData)) {
      throw new TypeError('export requires a WellSim case object');
    }
    if (caseData.app !== 'WellSim') throw new TypeError('not a WellSim case');
    if (caseData.version !== 1) throw new TypeError(`unsupported WellSim case version ${caseData.version}`);
  }

  function formatsFor(dataType) {
    return FORMATS.filter((format) => format.dataTypes.includes(dataType));
  }

  function safeBaseName(value) {
    let name = String(value ?? '').normalize('NFKC');
    name = name.replace(/[\\/]+/g, '-').replace(/[<>:"|?*\u0000-\u001f]/g, '-');
    name = name.replace(/\s+/g, ' ').replace(/^[. -]+|[. ]+$/g, '').trim().slice(0, 100);
    if (!name) name = 'wellsim-case';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `wellsim-${name}`;
    return name;
  }

  function withExtension(baseName, extension) {
    const safe = safeBaseName(baseName);
    return safe.toLowerCase().endsWith(`.${extension}`) ? safe : `${safe}.${extension}`;
  }

  function sectionFor(field, metadata) {
    if (metadata?.section) return String(metadata.section);
    const split = String(field).indexOf('-');
    return split > 0 ? String(field).slice(0, split) : 'case';
  }

  function isPlainNumber(text) {
    return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(text);
  }

  // Excel and similar programs may interpret text beginning with these
  // characters as a formula. Numeric values (including negatives) remain
  // numeric; non-numeric formula-like values are forced to text.
  function spreadsheetSafe(value) {
    if (value == null) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    const leftTrimmed = text.replace(/^\s+/, '');
    if (/^[=+@]/.test(leftTrimmed) || (leftTrimmed.startsWith('-') && !isPlainNumber(leftTrimmed))) {
      return `'${text}`;
    }
    return text;
  }

  function workbookValue(value, metadata = {}) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    const text = String(value);
    if ((metadata.valueType === 'number' || metadata.unit) && isPlainNumber(text.trim())) {
      const number = Number(text);
      if (Number.isFinite(number)) return number;
    }
    return spreadsheetSafe(text);
  }

  function safeSheetName(value) {
    const cleaned = String(value ?? '')
      .normalize('NFKC')
      .replace(/[\\/*?:\[\]]/g, '-')
      .replace(/^'+|'+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31);
    return cleaned || 'Data';
  }

  function uniqueSheetName(value, usedNames) {
    const base = safeSheetName(value);
    let candidate = base;
    let sequence = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      const suffix = ` ${sequence}`;
      candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
      sequence += 1;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  }

  function titleFromIdentifier(value) {
    return String(value ?? '')
      .replace(/[-_]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function caseWorkbookModel(caseData, options = {}) {
    assertCase(caseData);
    const fieldMeta = options.fieldMeta ?? {};
    const gridMeta = options.gridMeta ?? {};
    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const computed = new Set(caseData.computed ?? []);
    const usedNames = new Set();
    const sheets = [];
    const safeText = (value) => spreadsheetSafe(value ?? '');
    const safeGeneratedAt = safeText(generatedAt);

    const addSheet = (id, requestedName, kind, columns, rows) => {
      sheets.push(Object.freeze({
        id,
        name: uniqueSheetName(requestedName, usedNames),
        kind,
        columns: Object.freeze(columns.map((column) => Object.freeze({ ...column }))),
        rows: Object.freeze(rows.map((row) => Object.freeze([...row]))),
      }));
    };

    const inputs = Object.keys(caseData.inputs ?? {}).sort().map((field) => {
      const meta = fieldMeta[field] ?? {};
      return [
        safeText(sectionFor(field, meta)),
        safeText(field),
        safeText(meta.label ?? titleFromIdentifier(field)),
        workbookValue(caseData.inputs[field], meta),
        safeText(meta.unit ?? ''),
        computed.has(field) ? 'Calculated' : 'User input',
      ];
    });
    for (const field of [...computed].sort()) {
      if (Object.hasOwn(caseData.inputs ?? {}, field)) continue;
      const meta = fieldMeta[field] ?? {};
      inputs.push([
        safeText(sectionFor(field, meta)),
        safeText(field),
        safeText(meta.label ?? titleFromIdentifier(field)),
        'Calculated by WellSim; not stored in the case file',
        safeText(meta.unit ?? ''),
        'Calculated',
      ]);
    }

    const selections = [];
    for (const field of Object.keys(caseData.selects ?? {}).sort()) {
      const meta = fieldMeta[field] ?? {};
      selections.push(['Select', safeText(field), safeText(meta.label ?? titleFromIdentifier(field)), workbookValue(caseData.selects[field])]);
    }
    for (const field of Object.keys(caseData.radios ?? {}).sort()) {
      selections.push(['Option', safeText(field), safeText(titleFromIdentifier(field)), workbookValue(caseData.radios[field])]);
    }

    const gridDefinitions = Object.keys(caseData.grids ?? {}).sort().map((gridName) => {
      const records = Array.isArray(caseData.grids[gridName]) ? caseData.grids[gridName] : [];
      const fields = [...new Set(records.flatMap((record) => Object.keys(record ?? {})))].sort();
      return {
        id: `grid-${gridName}`,
        requestedName: titleFromIdentifier(gridName),
        columns: [{ key: '_row', label: 'Row', valueType: 'number' }, ...fields.map((field) => {
          const meta = gridMeta[gridName]?.[field] ?? {};
          const label = meta.label ?? titleFromIdentifier(field);
          return {
            key: field,
            label: safeText(meta.unit ? `${label} (${meta.unit})` : label),
            unit: safeText(meta.unit ?? ''),
          };
        })],
        rows: records.map((record, index) => [
          index + 1,
          ...fields.map((field) => {
            const meta = gridMeta[gridName]?.[field] ?? {};
            return workbookValue(record?.[field], {
              ...meta,
              valueType: meta.valueType ?? (isPlainNumber(String(record?.[field] ?? '').trim()) ? 'number' : 'text'),
            });
          }),
        ]),
      };
    });

    addSheet('summary', 'Summary', 'key-value', [
      { key: 'property', label: 'Property' },
      { key: 'value', label: 'Value' },
    ], [
      ['Document', 'WellSim engineering case export'],
      ['Case schema', CASE_SCHEMA_ID],
      ['Workbook schema', WORKBOOK_SCHEMA_ID],
      ['Case saved at', safeText(caseData.savedAt ?? '')],
      ['Workbook generated at', safeGeneratedAt],
      ['Active well type', safeText(caseData.activeTab ?? '')],
      ['Input fields', inputs.length],
      ['Selections', selections.length],
      ['Tabular datasets', gridDefinitions.length],
      ['Restorable case', 'No — use the WellSim JSON export to restore a case'],
    ]);

    addSheet('inputs', 'Inputs', 'table', [
      { key: 'section', label: 'Section' },
      { key: 'field', label: 'Field ID' },
      { key: 'label', label: 'Engineering label' },
      { key: 'value', label: 'Value' },
      { key: 'unit', label: 'Unit' },
      { key: 'state', label: 'Source state' },
    ], inputs);

    addSheet('selections', 'Selections', 'table', [
      { key: 'type', label: 'Selection type' },
      { key: 'field', label: 'Field ID' },
      { key: 'label', label: 'Label' },
      { key: 'value', label: 'Selected value' },
    ], selections);

    for (const grid of gridDefinitions) {
      addSheet(grid.id, grid.requestedName, 'table', grid.columns, grid.rows);
    }

    addSheet('manifest', 'Manifest', 'key-value', [
      { key: 'property', label: 'Property' },
      { key: 'value', label: 'Value' },
    ], [
      ['export_contract_version', CONTRACT_VERSION],
      ['source_schema_id', CASE_SCHEMA_ID],
      ['workbook_schema_id', WORKBOOK_SCHEMA_ID],
      ['source_app', caseData.app],
      ['source_case_version', caseData.version],
      ['generated_at', safeGeneratedAt],
      ['deployment_revision', safeText(options.deploymentRevision ?? '')],
      ['source_checksum_sha256', safeText(options.sourceChecksum ?? '')],
      ['round_trip', 'false'],
      ['formula_policy', 'none'],
      ['external_links', 'none'],
      ['macros', 'none'],
    ]);

    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      schemaId: CASE_SCHEMA_ID,
      workbookSchemaId: WORKBOOK_SCHEMA_ID,
      generatedAt: safeGeneratedAt,
      title: safeText(options.title ?? 'WellSim engineering case export'),
      sheets: Object.freeze(sheets),
    });
  }

  function csvCell(value) {
    return `"${spreadsheetSafe(value).replace(/"/g, '""')}"`;
  }

  function caseRows(caseData, fieldMeta = {}) {
    const rows = [];
    const push = (recordType, section, row, field, label, unit, value) => {
      rows.push([recordType, section, row, field, label, unit, value]);
    };

    push('metadata', 'case', '', 'schema_id', 'Schema', '', CASE_SCHEMA_ID);
    push('metadata', 'case', '', 'export_contract_version', 'Export contract version', '', CONTRACT_VERSION);
    push('metadata', 'case', '', 'saved_at', 'Saved at', 'ISO 8601', caseData.savedAt ?? '');
    push('metadata', 'case', '', 'active_tab', 'Active well type', '', caseData.activeTab ?? '');

    for (const field of Object.keys(caseData.inputs ?? {}).sort()) {
      const meta = fieldMeta[field] ?? {};
      push('input', sectionFor(field, meta), '', field, meta.label ?? field, meta.unit ?? '', caseData.inputs[field]);
    }
    for (const field of Object.keys(caseData.selects ?? {}).sort()) {
      const meta = fieldMeta[field] ?? {};
      push('select', sectionFor(field, meta), '', field, meta.label ?? field, meta.unit ?? '', caseData.selects[field]);
    }
    for (const field of Object.keys(caseData.radios ?? {}).sort()) {
      push('selection', 'case', '', field, field, '', caseData.radios[field]);
    }
    for (const field of [...(caseData.computed ?? [])].sort()) {
      const meta = fieldMeta[field] ?? {};
      push('computed', sectionFor(field, meta), '', field, meta.label ?? field, meta.unit ?? '', 'calculated by WellSim');
    }
    for (const gridName of Object.keys(caseData.grids ?? {}).sort()) {
      const grid = Array.isArray(caseData.grids[gridName]) ? caseData.grids[gridName] : [];
      grid.forEach((record, index) => {
        for (const field of Object.keys(record ?? {}).sort()) {
          push('grid', gridName, index + 1, field, field, '', record[field]);
        }
      });
    }
    return rows;
  }

  function jsonContent(caseData) {
    return `${JSON.stringify(caseData, null, 2)}\n`;
  }

  function csvContent(caseData, fieldMeta) {
    const header = ['record_type', 'section', 'row', 'field', 'label', 'unit', 'value'];
    const lines = [header, ...caseRows(caseData, fieldMeta)].map((row) => row.map(csvCell).join(','));
    // UTF-8 BOM makes Excel open non-ASCII labels correctly; CRLF is the most
    // interoperable record separator for spreadsheet programs.
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  function createArtifact(caseData, formatId, options = {}) {
    assertCase(caseData);
    const format = byId.get(formatId);
    if (!format || !format.dataTypes.includes('case')) throw new TypeError(`unsupported case export format ${formatId}`);
    const content = format.id === 'case-json'
      ? jsonContent(caseData)
      : csvContent(caseData, options.fieldMeta ?? {});
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      schemaId: CASE_SCHEMA_ID,
      formatId: format.id,
      filename: withExtension(options.baseName ?? 'wellsim-case', format.extension),
      mediaType: format.mediaType,
      content,
      roundTrip: format.roundTrip,
    });
  }

  root.WellSimExport = Object.freeze({
    contractVersion: CONTRACT_VERSION,
    caseSchemaId: CASE_SCHEMA_ID,
    workbookSchemaId: WORKBOOK_SCHEMA_ID,
    workbookCapability: WORKBOOK_CAPABILITY,
    formats: FORMATS,
    formatsFor,
    createArtifact,
    createWorkbookModel: caseWorkbookModel,
    safeBaseName,
    safeSheetName,
    spreadsheetSafe,
  });
})(globalThis);
