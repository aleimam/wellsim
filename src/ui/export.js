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
    formats: FORMATS,
    formatsFor,
    createArtifact,
    safeBaseName,
    spreadsheetSafe,
  });
})(globalThis);
